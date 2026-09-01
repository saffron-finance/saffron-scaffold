import { useCallback, useEffect, useState } from 'react'
import { type Address } from 'viem'
import { hasWallet, connect, currentAccounts, currentChainId, onWalletChange } from '../wallet/wallet'
import { IS_STATIC_MOCK } from '../mock/mode'

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | undefined>(undefined)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readState = useCallback(async () => {
    const [addrs, cid] = await Promise.all([currentAccounts(), currentChainId()])
    setAccount(addrs[0] ?? null)
    setChainId(cid)
  }, [])

  const doConnect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const addr = await connect()
      setAccount(addr)
      setChainId(await currentChainId())
    } catch (e) {
      setError((e as Error).message)
      throw e // re-throw so the caller (e.g. the deposit modal) can surface it
    } finally {
      setConnecting(false)
    }
  }, [])

  useEffect(() => {
    // The static example must not inspect or subscribe to an injected wallet.
    if (IS_STATIC_MOCK) return
    if (!hasWallet()) return
    void readState()
    return onWalletChange(() => void readState())
  }, [readState])

  if (IS_STATIC_MOCK) {
    return {
      account: null,
      chainId: undefined,
      connecting: false,
      error: null,
      available: false,
      connect: async () => {},
    }
  }

  return { account, chainId, connecting, error, available: hasWallet(), connect: doConnect }
}
