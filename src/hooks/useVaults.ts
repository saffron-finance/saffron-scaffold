import { useCallback, useEffect, useState } from 'react'
import { loadAllVaults, type VariableVault } from '../chain/vaults'

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
      const { vaults, errors } = await loadAllVaults()
      // Sort by variable-side activity: most variable capital deposited first.
      vaults.sort((a, b) => (b.variableDeposited > a.variableDeposited ? 1 : -1))
      setState({ loading: false, vaults, errors, loadedAt: Date.now() })
    } catch (err) {
      setState({ loading: false, vaults: [], errors: [(err as Error).message], loadedAt: Date.now() })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
