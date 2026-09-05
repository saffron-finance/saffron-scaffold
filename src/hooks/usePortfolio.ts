import { useEffect, useState } from 'react'
import { type Address } from 'viem'
import { erc20Abi } from '../chain/abis'
import { clientFor } from '../chain/clients'
import { type VariableVault } from '../chain/vaults'

export interface PortfolioPosition {
  vault: VariableVault
  balance: bigint
}

export function usePortfolio(account: Address | null, vaults: VariableVault[]) {
  const [positions, setPositions] = useState<PortfolioPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account) {
      setPositions([])
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const groups = new Map<VariableVault['chainKey'], VariableVault[]>()
    for (const vault of vaults) groups.set(vault.chainKey, [...(groups.get(vault.chainKey) ?? []), vault])
    void Promise.all([...groups.entries()].map(async ([chainKey, chainVaults]) => {
      const client = clientFor(chainKey)
      if (!client) return []
      const balances = await client.multicall({
        allowFailure: true,
        contracts: chainVaults.map((vault) => ({
          address: vault.variableBearer, abi: erc20Abi, functionName: 'balanceOf', args: [account],
        })),
      })
      return chainVaults.flatMap((vault, index) => {
        const result = balances[index]
        const balance = result.status === 'success' ? result.result as bigint : 0n
        return balance > 0n ? [{ vault, balance }] : []
      })
    }))
      .then((rows) => {
        if (!cancelled) setPositions(rows.flat())
      })
      .catch(() => {
        if (!cancelled) setError('Portfolio balances could not be loaded. Try again shortly.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [account, vaults])

  return { positions, loading, error }
}
