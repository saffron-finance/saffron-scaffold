import { useEffect, useState } from 'react'
import { type Address } from 'viem'
import { assertWalletAccount, walletClient } from '@lab/wallet/wallet'
import { adminSessionMessage } from '../../shared/vault-lifecycle.mjs'
import { requestJson, requestUrl } from './transport'

export interface OperatorSession { wallet: Address; csrf: string; expiresAt: string }

/** HttpOnly session plus memory-only CSRF. Never persist signing/session secrets. */
export function useOperator(account: Address | null) {
  const [session, setSession] = useState<OperatorSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(Boolean(account))
  useEffect(() => {
    let cancelled = false
    setSession(null); setError(null); setChecking(Boolean(account))
    if (account) void requestJson('/operator/session').then(value => {
      if (!cancelled && value.wallet?.toLowerCase() === account.toLowerCase()) setSession(value)
    }).catch(() => {}).finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [account])
  async function login() {
    if (!account) return
    setBusy(true); setError(null)
    try {
      const proof = await requestJson('/operator/challenge', { wallet: account })
      if (proof.origin !== window.location.origin || proof.chainId !== 4663 || proof.wallet !== account.toLowerCase()
        || !/^[0-9a-f-]{36}$/.test(proof.nonce) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error('Operator challenge changed. Retry.')
      await assertWalletAccount(account)
      const signature = await walletClient().signMessage({ account, message: adminSessionMessage(proof) })
      await assertWalletAccount(account)
      setSession(await requestJson('/operator/login', { wallet: account, nonce: proof.nonce, signature }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Operator sign-in failed.') }
    finally { setBusy(false) }
  }
  const current = session && session.wallet.toLowerCase() === account?.toLowerCase() && Date.parse(session.expiresAt) > Date.now() ? session : null
  async function mutate(path: string, body: object) {
    if (!current || !account) throw new Error('Sign in as a test operator.')
    await assertWalletAccount(account)
    const response = await fetch(requestUrl(path), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-saffron-csrf': current.csrf }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? 'Admin action failed.')
    return result
  }
  return { session: current, checking, error, busy, login, mutate }
}
