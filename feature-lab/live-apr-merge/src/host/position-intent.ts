import type { Address, Hex } from 'viem'

export type Intent = { actionId?: string; stage: string; account: Address; deploymentId: string; to: Address; data: Hex; value: string; nonce: number; hash?: Hex; chainConfirmed?: boolean }
export type IntentRecord = { raw: string | null; value: Intent | null }
export const intentChanged = () => new Error('Saved wallet action changed in another tab. Review the current transaction before continuing.')

/** Read under the wallet lock before any recovery/send. Legacy records remain
 * valid; a malformed record is never treated as permission for a new send. */
export function readIntentRecord(key: string, account: Address, deploymentId: string): IntentRecord {
  const raw = localStorage.getItem(key)
  if (raw === null) return { raw, value: null }
  const value = JSON.parse(raw) as Intent
  if (value?.account?.toLowerCase() !== account.toLowerCase() || value.deploymentId !== deploymentId
    || !Number.isSafeInteger(value.nonce) || value.nonce < 0) {
    throw new Error('Saved wallet action cannot be read. Preserve its record and recover the original transaction before continuing.')
  }
  return { raw, value }
}

/** New sends have an immutable UUID; legacy intents use their immutable action
 * fields. Receipt replacements may change a hash, never the action identity. */
export function intentIdentity(value: Intent | null): string | null {
  return value ? value.actionId ?? JSON.stringify([value.account.toLowerCase(), value.deploymentId,
    value.stage, value.to, value.data, value.value, value.nonce]) : null
}

/** Compare the exact storage revision before every update/removal, even while
 * holding Web Locks. A late callback or old client cannot erase a newer intent.
 * The browser emits storage in other tabs; the custom event covers this tab. */
export function writeIntentRecord(key: string, previous: IntentRecord, value: Intent | null): IntentRecord {
  if (localStorage.getItem(key) !== previous.raw) throw intentChanged()
  const raw = value ? JSON.stringify(value) : null
  if (raw === null) localStorage.removeItem(key)
  else localStorage.setItem(key, raw)
  window.dispatchEvent(new CustomEvent('saffron:position-action', { detail: key }))
  return { raw, value }
}
