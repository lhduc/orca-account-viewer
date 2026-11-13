# Orca Account Viewer

An [Orca](https://github.com/stablyai/orca) plugin that shows **which Claude account each running agent uses**, per workspace.

- **Panel "Claude accounts"** (right sidebar): every workspace with the account of each running Claude tab. Running workspaces first, idle ones below, plus the account new tabs will start on.
- **Status bar item**: `Agent: account` for the workspace you are looking at, e.g. `Claude: me ×2 · work` (`Claude: -` when none runs). Hover for the workspace name and each tab. Only Claude is detected so far.

Read-only. No network, no writes, no token access.

## Requirements

- macOS (Orca keeps its account folders there; other systems show a notice and do nothing)
- Orca `>= 1.4.248`
- Claude Code run from Orca terminals, with accounts managed in Orca's Claude account switcher

## Install

```bash
# 1. Install the plugin from this repo. Orca prints what it will be granted and a fingerprint.
orca plugin install lhduc/orca-account-viewer

# 2. Re-run with the fingerprint from step 1 to approve.
orca plugin install lhduc/orca-account-viewer --approve <fingerprint>
```

No build step: Orca loads the `.ts` / `.tsx` files directly. The installed copy is pinned to an exact commit, so it survives Orca restarts.

If `orca` is not on your PATH, use `/Applications/Orca.app/Contents/Resources/bin/orca`.

Open the panel from the command palette (**Claude accounts: show panel**) or by clicking the `Claude: …` item in the status bar.

## Update

```bash
orca plugin update
```

## Uninstall

```bash
orca plugin uninstall lhduc.account-viewer
```

## What it reads and why

Approving the plugin grants it:

- Run its own Node.js worker with your user's access (it uses this to read the files below and list processes).
- Read the name, branch and terminal list of the focused workspace (`workspace:read`).

On each refresh the worker:

1. Lists processes named `claude` (`ps`) and reads `ORCA_TERMINAL_HANDLE` from those processes' environment only.
2. Reads `sessions/<pid>.json` inside `~/.claude` and Orca's managed account folders (`~/Library/Application Support/orca/claude-profiles/*/home`) to find which folder the Claude process runs from.
3. Reads only `oauthAccount.emailAddress` from each folder's `.claude.json`. Tokens are never read.
4. Reads Orca's `claude-profiles/selected-host` file to show which account new tabs start on.

Nothing leaves your machine.

## Development

```bash
git clone https://github.com/lhduc/orca-account-viewer
cd orca-account-viewer
orca plugin validate .
orca plugin dev load .          # prints a fingerprint, re-run with --approve <fingerprint>
```

Orca reloads the plugin when files change. A dev folder overrides an installed copy with the same key and is forgotten when Orca restarts.

## License

MIT
