/** Non-interactive provider reads must never own the wallet lock indefinitely.
 * This deadline is NOT applied to transaction submissions or signing prompts. */
export const WALLET_READ_TIMEOUT_MS = 15_000

/** Bound a read without retrying it. EIP-1193 cannot abort the underlying call;
 * attaching both handlers consumes late results/rejections without using them. */
export function boundedWalletRead<T>(read: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + WALLET_READ_TIMEOUT_MS
    const timeout = () => reject(new Error('Wallet read timed out. Check your wallet connection and try again.'))
    const timer = setTimeout(timeout, WALLET_READ_TIMEOUT_MS)
    Promise.resolve().then(read).then(value => {
      clearTimeout(timer)
      if (Date.now() >= deadline) timeout()
      else resolve(value)
    }, error => { clearTimeout(timer); reject(error) })
  })
}

/** One revocable permission to prepare a wallet action. Every asynchronous
 * boundary must pass through this scope, and commit must check it synchronously.
 * Cancelling stops the continuation, not the external wallet's pending request.
 * Never race a send with this scope: durable recovery owns real submissions. */
export class WalletPreflight {
  private controller = new AbortController()
  constructor(private isCurrent: () => boolean = () => true) {}

  cancel(reason = 'Wallet preparation cancelled. No transaction was sent.'): void {
    this.controller.abort(new Error(reason))
  }

  assertActive(): void {
    if (!this.isCurrent()) this.cancel()
    if (this.controller.signal.aborted) throw this.controller.signal.reason
  }

  /** Read-only work has a deadline; a stalled read revokes the whole action. */
  read<T>(read: () => Promise<T>): Promise<T> { return this.wait(read, true) }

  /** Network-switch prompts remain cancellable but allow human response time. */
  prompt<T>(prompt: () => Promise<T>): Promise<T> { return this.wait(prompt, false) }

  private wait<T>(operation: () => Promise<T>, timed: boolean): Promise<T> {
    this.assertActive()
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal
      const deadline = timed ? Date.now() + WALLET_READ_TIMEOUT_MS : Infinity
      const expire = () => this.cancel('Wallet preparation timed out. No transaction was sent. Check your wallet connection and try again.')
      const timer = timed ? setTimeout(expire, WALLET_READ_TIMEOUT_MS) : undefined
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => { this.assertActive(); return operation() }).then(value => {
        // A suspended tab can resume its RPC before its overdue timer runs.
        if (Date.now() >= deadline) expire()
        cleanup()
        try { this.assertActive(); resolve(value) } catch (error) { reject(error) }
      }, error => { cleanup(); reject(signal.aborted ? signal.reason : error) })
    })
  }
}
