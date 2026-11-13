import { defineCheck } from 'orca/testing'

const ws = (id: string, name: string, branch: string, tabs: { terminalId: string; name: string; account: string }[]) => ({
  id,
  name,
  branch,
  path: `/r/${name}`,
  tabs
})

const base = {
  supported: true,
  newTabAccount: 'work@example.com',
  elsewhere: [] as { terminalId: string; name: string; account: string }[]
}

export default defineCheck({
  'two accounts': {
    requests: {
      'accounts.overview': {
        ...base,
        workspaces: [
          ws('w1', 'app', 'main', [{ terminalId: 't1', name: '', account: 'work@example.com' }]),
          ws('w2', 'side', 'main', [
            { terminalId: 't2', name: '', account: 'me@example.com' },
            { terminalId: 't3', name: 'tests', account: 'me@example.com' }
          ]),
          ws('w3', 'ops', 'dev', [])
        ]
      }
    }
  },
  'outside any workspace': {
    requests: {
      'accounts.overview': {
        ...base,
        workspaces: [ws('w1', 'app', 'main', [])],
        elsewhere: [{ terminalId: 't9', name: '', account: 'me@example.com' }]
      }
    }
  },
  'no claude running': { requests: { 'accounts.overview': { ...base, workspaces: [ws('w1', 'app', 'main', [])] } } },
  'not macOS': { requests: { 'accounts.overview': { ...base, supported: false, workspaces: [] } } }
})
