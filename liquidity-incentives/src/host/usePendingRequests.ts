import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { assertWalletAccount, walletClient } from '@lab/wallet/wallet'
import { adminListMessage } from '../../shared/request-admin.mjs'
import { requestJson } from './transport'

/** This is the existing fixed-income-shaped projection, not a second schema. */
export interface PendingRequest {
  requestId: string; chainId: number; status: string; token0Address: string; token1Address: string
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
    return () => window.removeEventListener('liqifi:request-saved', refresh)
  }, [])
  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    setState({ wallet: account, rows: [], loading: true, error: null })
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

/** Owner verification is a nonce-bound read-only signature, never a payment. */
export async function loadAdminRequests(account: Address, chainId: number): Promise<PendingRequest[]> {
  const challenge = await requestJson('/admin/challenge', { wallet: account, chainId })
  if (typeof challenge.wallet !== 'string' || challenge.wallet.toLowerCase() !== account.toLowerCase()
    || challenge.chainId !== chainId || typeof challenge.nonce !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(challenge.nonce) || !Number.isFinite(Date.parse(challenge.expiresAt))
    || Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('Admin proof expired or changed. Retry to refresh it.')
  await assertWalletAccount(account)
  const signature = await walletClient().signMessage({ account, message: adminListMessage(challenge) })
  const result = await requestJson('/admin/list', { ...challenge, signature })
  if (!result.success || !Array.isArray(result.data)) throw new Error('Admin requests are unavailable.')
  return result.data
}
