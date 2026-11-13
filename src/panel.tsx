import { atom, Callout, Card, Row, Stack, Text, on, plugin, read, set, type PanelContext } from 'orca'
import type { TabAccount, WorkspaceAccounts } from './protocol'

type Overview = {
  supported: boolean
  newTabAccount: string
  workspaces: WorkspaceAccounts[]
  elsewhere: TabAccount[]
}

const data = atom<Overview | null>(null)
const error = atom<string | null>(null)

async function refresh(): Promise<void> {
  try {
    set(data, await plugin.request('accounts.overview', {}))
    set(error, null)
  } catch (e) {
    set(error, e instanceof Error ? e.message : String(e))
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(on('workspace.changed', () => void refresh()))
  // Claude starting or quitting in a tab raises no event: poll while the panel is open.
  const timer = setInterval(() => void refresh(), 10_000)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })
  void refresh()
}

/** `me@x.com ×2 · work@y.com`: each account once with a count past one. */
function accountsOf(tabs: TabAccount[]): string {
  const counts = new Map<string, number>()
  for (const t of tabs) counts.set(t.account, (counts.get(t.account) ?? 0) + 1)
  return [...counts].map(([a, c]) => (c > 1 ? `${a} ×${c}` : a)).join(' · ')
}

function WorkspaceRow(props: { w: WorkspaceAccounts }) {
  const { w } = props
  return (
    <Stack gap="none">
      <Text weight="medium" truncate>{w.branch ? `${w.name} (${w.branch})` : w.name}</Text>
      <Text muted={w.tabs.length === 0} size="xs" truncate>
        {w.tabs.length ? accountsOf(w.tabs) : 'No Claude running'}
      </Text>
    </Stack>
  )
}

export default function Panel() {
  const d = read(data)
  const err = read(error)
  if (err) return <Callout tone="danger" title="Could not load accounts">{err}</Callout>
  if (!d) return <Text muted>Loading accounts…</Text>
  if (!d.supported) {
    return (
      <Callout tone="warning" title="macOS only for now">
        Account Viewer reads the account folders Orca keeps on macOS. It does nothing on this system.
      </Callout>
    )
  }
  // Running ones first, so the answer to "who is on which account" is at the top.
  const active = d.workspaces.filter((w) => w.tabs.length > 0)
  const idle = d.workspaces.filter((w) => w.tabs.length === 0)
  return (
    <Stack gap="md">
      <Text muted size="xs">{`New tabs start on ${d.newTabAccount} (Orca's account setting).`}</Text>
      <Card title="Running Claude">
        <Stack gap="md">
          {active.map((w) => <WorkspaceRow key={w.id} w={w} />)}
          {d.elsewhere.length ? (
            <Stack gap="none">
              <Text weight="medium">Outside any workspace</Text>
              <Text size="xs" truncate>{accountsOf(d.elsewhere)}</Text>
            </Stack>
          ) : null}
          {active.length === 0 && d.elsewhere.length === 0 ? <Text muted>No Claude tab is running.</Text> : null}
        </Stack>
      </Card>
      {idle.length ? (
        <Card title="Idle workspaces">
          <Stack gap="md">{idle.map((w) => <WorkspaceRow key={w.id} w={w} />)}</Stack>
        </Card>
      ) : null}
    </Stack>
  )
}
