export const DISCONNECT_GRACE_MS = 20_000

export interface ConnectionHealth {
  lastMessageAt: number
  transportFailedAt: number | null
  rpcFailedAt: number | null
  established: boolean
}

/** Start a page-local health clock; it never owns a timer or network request. */
export function initialConnection(now: number): ConnectionHealth {
  return { lastMessageAt: now, transportFailedAt: null, rpcFailedAt: null, established: false }
}

/** Every valid SSE event proves the transport is alive, even during replay.
 * Only a status snapshot establishes RPC health; catch-up work and block age
 * are not transport failures. Repeated failures preserve the original clock.
 */
export function receiveConnection(
  previous: ConnectionHealth,
  now: number,
  status?: { ready: boolean; error: string | null }
): ConnectionHealth {
  const rpcHealthy = status ? status.ready && !status.error : null
  return {
    ...previous,
    lastMessageAt: now,
    transportFailedAt: null,
    // A cold pool waiting for its first scheduled scan is not an RPC failure.
    // Actual errors retain their original deadline until a ready status recovers.
    rpcFailedAt: !status
      ? previous.rpcFailedAt
      : status.error
      ? previous.rpcFailedAt ?? now
      : status.ready
      ? null
      : previous.rpcFailedAt,
    established: previous.established || rpcHealthy === true,
  }
}

/** Native EventSource reconnects itself; remember the FIRST error, not each retry. */
export function loseConnection(previous: ConnectionHealth, now: number): ConnectionHealth {
  return { ...previous, transportFailedAt: previous.transportFailedAt ?? now }
}

/** Report only a continuous failure strictly longer than 20 seconds.
 * The message deadline also catches a silently stalled stream. Independent
 * server status heartbeats keep a slow, healthy scan from tripping that guard.
 */
export function connectionStatus(health: ConnectionHealth, now: number) {
  const transportSince = health.transportFailedAt ?? health.lastMessageAt
  const disconnected =
    now - transportSince > DISCONNECT_GRACE_MS ||
    (health.rpcFailedAt !== null && now - health.rpcFailedAt > DISCONNECT_GRACE_MS)
  return disconnected ? 'Disconnected' : health.established ? 'Connected' : 'Connecting'
}
