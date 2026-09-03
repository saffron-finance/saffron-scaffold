import { useCallback, useEffect, useState } from 'react'
import { normalizeFixedVault, type FixedVault } from '../fixedVaults/model'
import { IS_STATIC_MOCK } from '../mock/mode'

interface State {
  loading: boolean
  vaults: FixedVault[]
  errors: string[]
  loadedAt: number | null
}

const CHAINS = ['ethereum', 'arbitrum', 'robinhood'] as const

/** Load the production fixed-vault list, or its immutable Pages fixture. */
export function useFixedVaults() {
  const [state, setState] = useState<State>({ loading: true, vaults: [], errors: [], loadedAt: null })

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }))
    if (IS_STATIC_MOCK) {
      const mock = await import('../mock/fixedVaults')
      setState({ loading: false, vaults: mock.loadMockFixedVaults(), errors: [], loadedAt: mock.FIXED_MOCK_CAPTURED_AT })
      return
    }

    const errors: string[] = []
    const results = await Promise.all(
      CHAINS.map(async (chain) => {
        try {
          const url = new URL(`fixed-vaults/${chain}`, document.baseURI)
          const response = await fetch(url, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          const rows = Array.isArray(payload?.data) ? payload.data : []
          return rows.flatMap((row: Record<string, any>) => {
            const normalized = normalizeFixedVault(row)
            return normalized ? [normalized] : []
          })
        } catch (error) {
          errors.push(`${chain}: ${(error as Error).message}`)
          return [] as FixedVault[]
        }
      }),
    )
    const vaults = results.flat().filter((vault) => vault.claimTokenSupply === 0n)
    vaults.sort((a, b) => b.apr - a.apr)
    setState({ loading: false, vaults, errors, loadedAt: Date.now() })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
