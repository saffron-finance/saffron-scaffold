import { useCallback, useEffect, useState } from 'react'
import { loadAllVaults, type VariableVault } from '../chain/vaults'
import { IS_STATIC_MOCK } from '../mock/mode'

interface State {
  loading: boolean
  vaults: VariableVault[]
  errors: string[]
  loadedAt: number | null
}

export function useVaults() {
  const [state, setState] = useState<State>({ loading: true, vaults: [], errors: [], loadedAt: null })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      // GitHub Pages has no RPC server. Its build uses an immutable onchain
      // snapshot, while normal builds preserve the live multicall loader.
      const result = IS_STATIC_MOCK
        ? await import('../mock/snapshot').then(({ loadMockVaults, MOCK_CAPTURED_AT }) => ({
            vaults: loadMockVaults(),
            errors: [],
            loadedAt: MOCK_CAPTURED_AT,
          }))
        : { ...(await loadAllVaults()), loadedAt: Date.now() }
      const { vaults, errors, loadedAt } = result
      // Sort by variable-side activity: most variable capital deposited first.
      vaults.sort((a, b) => (b.variableDeposited > a.variableDeposited ? 1 : -1))
      setState({ loading: false, vaults, errors, loadedAt })
    } catch (err) {
      setState({ loading: false, vaults: [], errors: [(err as Error).message], loadedAt: Date.now() })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
