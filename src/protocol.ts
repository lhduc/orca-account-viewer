// Panel <-> worker contract, read by src/panel.tsx and worker/main.ts.

/** A running interactive Claude conversation in an Orca terminal. */
export type TabAccount = {
  terminalId: string
  /** Claude's own session name, or '' when unnamed. */
  name: string
  /** Account email, or the Orca profile id when signed out. */
  account: string
}

export type WorkspaceAccounts = {
  id: string
  name: string
  branch: string | null
  path: string
  tabs: TabAccount[]
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging
  interface PluginRequests {
    'accounts.overview': {
      input: Record<string, never>
      output: {
        /** False off macOS: Orca's account folders are only located there. */
        supported: boolean
        /** Account Orca's switcher gives new tabs, e.g. "me@example.com". */
        newTabAccount: string
        workspaces: WorkspaceAccounts[]
        /** Claude tabs whose folder matches no Orca workspace. */
        elsewhere: TabAccount[]
      }
    }
  }
}
