import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { assertWalletAccount, walletClient } from '@lab/wallet/wallet'
import { canonicalPair, canonicalProgram, programAdminMessage, validPair, validProgram,
  type IncentivePair, type IncentiveProgram, type ProgramAdminProof } from '../../shared/incentive-program.mjs'
import type { Offer } from '../incentives/model'
import { BASE } from './transport'

export interface AdminCatalog { pairs: IncentivePair[]; programs: IncentiveProgram[] }
async function catalogJson(path = '', body?: object, signal?: AbortSignal) {
  const response = await fetch(`${BASE}/incentive-programs${path}`, { cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value || typeof value !== 'object') throw new Error(value?.error ?? 'Incentive programs are unavailable. Retry shortly.')
  return value
}

export function useIncentivePrograms() {
  const [state, setState] = useState<{ offers: Offer[]; loading: boolean; error?: string }>({ offers: [], loading: true })
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision(value => value + 1)
  useEffect(() => {
    const controller = new AbortController()
    setState({ offers: [], loading: true })
    void catalogJson('', undefined, controller.signal).then(value => {
      if (!Array.isArray(value.offers) || !value.offers.every((offer: unknown) => validPair(offer) && validProgram(offer))) {
        throw new Error('The incentive catalog is invalid. Refresh to retry.')
      }
      if (!controller.signal.aborted) setState({ offers: value.offers, loading: false })
    }).catch(error => { if (!controller.signal.aborted) setState({ offers: [], loading: false, error: error.message }) })
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    window.addEventListener('saffron:catalog-updated', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('saffron:catalog-updated', refresh) }
  }, [])
  return { ...state, refresh }
}

/** Compare the server challenge to the requested edit before showing a wallet signature. */
export async function administerCatalog(wallet: Address, action: ProgramAdminProof['action'], payload: IncentivePair | IncentiveProgram | null = null): Promise<AdminCatalog> {
  const expected = action === 'save-pair' ? canonicalPair(payload as IncentivePair)
    : action === 'save-program' ? canonicalProgram(payload as IncentiveProgram) : null
  const proof = await catalogJson('/admin/challenge', { wallet, action, payload: expected }) as ProgramAdminProof
  if (proof.wallet?.toLowerCase() !== wallet.toLowerCase() || proof.chainId !== 4663 || proof.action !== action
    || !/^[0-9a-f-]{36}$/.test(proof.nonce) || !Number.isFinite(Date.parse(proof.expiresAt))
    || Date.parse(proof.expiresAt) <= Date.now() || JSON.stringify(proof.payload) !== JSON.stringify(expected)) {
    throw new Error('Admin request changed. Reload and try again.')
  }
  await assertWalletAccount(wallet)
  const signature = await walletClient().signMessage({ account: wallet, message: programAdminMessage(proof) })
  await assertWalletAccount(wallet)
  const result = await catalogJson('/admin/execute', { wallet, nonce: proof.nonce, signature })
  if (!Array.isArray(result.pairs) || !result.pairs.every(validPair) || !Array.isArray(result.programs) || !result.programs.every(validProgram)) {
    throw new Error('The admin catalog is invalid. Reload before editing.')
  }
  window.dispatchEvent(new Event('saffron:catalog-updated'))
  return { pairs: result.pairs, programs: result.programs }
}
