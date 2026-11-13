// Read-only: maps each running interactive Claude tab to the account folder it runs from.
// No network, no writes, no terminal or launch access.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { basename, join, resolve } from 'node:path'
import type { Activate } from 'orca/worker'
import type { TabAccount, WorkspaceAccounts } from '../src/protocol'

const SUPPORTED = process.platform === 'darwin'
const AGENT = 'Claude'
const ORCA_DATA = join(homedir(), 'Library/Application Support/orca')
const PROFILES = join(ORCA_DATA, 'claude-profiles')

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Only the email is read from .claude.json; tokens are never touched. */
const claudeEmail = (home: string): string | null =>
  readJson(join(home, '.claude.json'))?.oauthAccount?.emailAddress ?? null

/** Home of the account selected in Orca's Claude switcher; '' = System default (~/.claude). */
function selectedHome(): string {
  try {
    return readFileSync(join(PROFILES, 'selected-host'), 'utf8').trim()
  } catch {
    return ''
  }
}

type Home = { dir: string; label: string }

/** ~/.claude (its .claude.json sits one level up, in the home folder) plus Orca's managed profiles. */
export function claudeHomes(): Home[] {
  const homes: Home[] = [{ dir: join(homedir(), '.claude'), label: claudeEmail(homedir()) ?? 'default (signed out)' }]
  try {
    for (const d of readdirSync(PROFILES, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const dir = join(PROFILES, d.name, 'home')
      homes.push({ dir, label: claudeEmail(dir) ?? `${d.name.slice(0, 8)} (signed out)` })
    }
  } catch {
    // No Orca accounts yet.
  }
  return homes
}

/** Process access, swapped out by tests. Environment is read only for Claude pids, never all processes. */
export const sys = {
  claudePids: async (): Promise<string[]> => {
    const { stdout } = await promisify(execFile)('ps', ['-Aww', '-o', 'pid=,args='], { maxBuffer: 64 << 20 })
    return stdout
      .split('\n')
      .map((l) => /^\s*(\d+)\s+(\S+)/.exec(l))
      .filter((m): m is RegExpExecArray => !!m && basename(m[2]) === 'claude')
      .map((m) => m[1])
  },
  withEnv: async (pids: string[]): Promise<string> =>
    (await promisify(execFile)('ps', ['-Eww', '-o', 'pid=,args=', '-p', pids.join(',')], { maxBuffer: 64 << 20 })).stdout
}

type ClaudeTab = TabAccount & { path: string }

/**
 * Orca puts the tab's handle in each process env (ORCA_TERMINAL_HANDLE); Claude writes
 * sessions/<pid>.json (kind, cwd, name) into the account folder it runs from.
 */
export async function claudeTabs(): Promise<ClaudeTab[]> {
  const pids = await sys.claudePids()
  if (pids.length === 0) return []
  const homes = claudeHomes()
  const tabs: ClaudeTab[] = []
  for (const line of (await sys.withEnv(pids)).split('\n')) {
    const pid = /^\s*(\d+)\s/.exec(line)?.[1]
    const terminalId = /\bORCA_TERMINAL_HANDLE=(term_[\w-]+)/.exec(line)?.[1]
    if (!pid || !terminalId) continue
    for (const h of homes) {
      const s = readJson(join(h.dir, 'sessions', `${pid}.json`))
      // Interactive only: a `claude -p` started inside the tab inherits its handle.
      if (s?.kind === 'interactive' && typeof s.cwd === 'string') {
        tabs.push({ terminalId, name: typeof s.name === 'string' ? s.name : '', account: h.label, path: s.cwd })
        break
      }
    }
  }
  return tabs
}

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

type Ws = { id: string; name: string; branch: string | null; path: string }

/** The workspace a folder belongs to: the deepest workspace containing it. */
export function workspaceAt(list: Ws[], path: string): Ws | undefined {
  const target = real(path)
  let best: { w: Ws; len: number } | undefined
  for (const w of list) {
    const root = real(w.path)
    if (target !== root && !target.startsWith(root + '/')) continue
    if (!best || root.length > best.len) best = { w, len: root.length }
  }
  return best?.w
}

/** `me`: the part of an email before the `@`. */
const shortName = (account: string) => account.split('@')[0]

/** `me ×2 · work`: each account once, first-seen order, with a count past one. */
export function summary(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ')
}

let ticker: ReturnType<typeof setInterval> | undefined
export function deactivate(): void {
  clearInterval(ticker)
}

const activate: Activate = async (orca) => {
  async function overview() {
    const { workspaces } = await orca.host.call('workspace.list', {})
    // Remote (SSH/WSL) workspaces have paths on another machine: skip them.
    const local: Ws[] = workspaces
      .filter((w) => !w.hostId || w.hostId === 'local')
      .map((w) => ({ id: w.id, name: w.name, branch: w.branch, path: w.path }))
    const byId = new Map<string, WorkspaceAccounts>(local.map((w) => [w.id, { ...w, tabs: [] }]))
    const elsewhere: TabAccount[] = []
    for (const { path, ...tab } of await claudeTabs().catch(() => [])) {
      const ws = workspaceAt(local, path)
      if (ws) byId.get(ws.id)!.tabs.push(tab)
      else elsewhere.push(tab)
    }
    const sel = selectedHome()
    const newTabAccount = (sel ? claudeEmail(sel) : claudeEmail(homedir())) ?? 'signed out'
    return { supported: SUPPORTED, newTabAccount, workspaces: [...byId.values()], elsewhere }
  }

  // Terminals of the focused workspace, from `workspace.changed`. Matching by terminal id (not by
  // workspace name) stays exact when several repos have a workspace called `main`.
  let focus: { name: string; terminals: Set<string> } | null = null

  async function refreshStatus(): Promise<void> {
    if (!SUPPORTED) return
    if (!focus) {
      await orca.host.call('statusBar.update', { id: 'account', text: 'Claude: -', tone: 'neutral' })
      return
    }
    const here = (await claudeTabs().catch(() => [])).filter((t) => focus!.terminals.has(t.terminalId))
    // `Agent: account`; Claude is the only agent detected so far.
    const text = `${AGENT}: ${here.length ? summary(here.map((t) => shortName(t.account))) : '-'}`
    const tooltip = [focus.name, ...here.map((t) => `${t.name || AGENT}: ${t.account}`)].join('\n').slice(0, 256)
    await orca.host.call('statusBar.update', {
      id: 'account',
      text,
      tooltip: tooltip || undefined,
      tone: here.length ? 'accent' : 'neutral'
    })
  }

  orca.panels.handle('accounts.overview', overview)

  // A Claude starting or quitting in a tab sends no event; catch it on a slow tick.
  ticker = setInterval(() => void refreshStatus().catch(() => undefined), 20_000)
  ticker.unref?.()
  orca.events.on('workspace.changed', async ({ context }) => {
    focus = context ? { name: context.displayName, terminals: new Set(context.terminals.map((t) => t.id)) } : null
    await refreshStatus().catch(() => undefined)
    // A new tab's Claude writes its session file a moment after the terminal opens.
    setTimeout(() => void refreshStatus().catch(() => undefined), 4000).unref?.()
  })
  void refreshStatus().catch((e) => orca.log(`initial refresh failed: ${String(e)}`))
}

export default activate
