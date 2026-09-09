import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { requestJson } from './transport'

/** This is the existing fixed-income-shaped projection, not a second schema. */
export interface PendingRequest {
  requestId: string; chainId: number; status: string; token0Address: string; token1Address: string
  submitterAddress: string; createdVaultAddress: string | null; lifecycle?: any
  poolAddress: string | null; durationSeconds: number; fixedCapacityAmount: string | null
  targetApr: number | null; createdAt: number; rejectionReason?: string; adminNotes?: string
  display: { pair: string; depositUsd?: string; paymentTxHash: string; paymentAsset: string; paymentAmount: string }
}

/** Address-filtered reads share the queue with LiqiFi; a wallet change hides old rows immediately. */
export function usePendingRequests(account: Address | null) {
  const [state, setState] = useState<{ wallet: Address | null; rows: PendingRequest[]; loading: boolean; error: string | null }>(
    { wallet: null, rows: [], loading: false, error: null })
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  useEffect(() => {
    window.addEventListener('liqifi:request-saved', refresh)
    window.addEventListener('saffron:vault-updated', refresh)
    window.addEventListener('focus', refresh)
    const visibleRefresh = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visibleRefresh)
    const timer = window.setInterval(visibleRefresh, 5000)
    return () => {
      window.removeEventListener('liqifi:request-saved', refresh)
      window.removeEventListener('saffron:vault-updated', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    setState(previous => ({ wallet: account, rows: previous.wallet === account ? previous.rows : [], loading: true, error: null }))
    void requestJson(`/my?wallet=${account}`, undefined, controller.signal).then((result) => {
      if (!result.success || !Array.isArray(result.data)) throw new Error('Pending requests are unavailable. Refresh to retry.')
      if (!controller.signal.aborted) setState({ wallet: account, rows: result.data, loading: false, error: null })
    }).catch((cause) => {
      if (!controller.signal.aborted) setState({ wallet: account, rows: [], loading: false,
        error: cause instanceof Error ? cause.message : 'Pending requests are unavailable.' })
    })
    return () => controller.abort()
  }, [account, revision])
  return { ...(state.wallet === account ? state : { rows: [], loading: Boolean(account), error: null }), refresh }
}
