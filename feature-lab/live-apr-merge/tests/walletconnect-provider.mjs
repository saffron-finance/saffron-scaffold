/** Test-only EIP-1193 session peer. AppKit and the application connector are real;
 * signing delegates to the existing disposable EVM wallet, never a live wallet. */
export class EthereumProvider {
  static async init(options) {
    const listeners = new Map()
    let session = JSON.parse(localStorage.getItem('saffron.fixture.wc-session') || 'null') || undefined
    let settle, reject
    const emit = (event, value) => { for (const fn of listeners.get(event) ?? []) fn(value) }
    const provider = {
      get session() { return session },
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn) },
      removeListener(event, fn) { listeners.get(event)?.delete(fn) },
      async request(args) {
        if (['eth_estimateGas', 'eth_getTransactionCount'].includes(args.method)) {
          const response = await fetch(options.rpcMap[4663], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...args }) })
          if (!response.ok) throw new Error('Read-only wallet RPC failed: ' + response.status)
          const result = await response.json(); if (result.error) throw new Error(result.error.message); return result.result
        }
        return window.fixtureWalletRequest('WalletConnect', args)
      },
      async connect() {
        emit('display_uri', 'wc:' + 'b'.repeat(64) + '@2?relay-protocol=irn&symKey=' + 'c'.repeat(64))
        return new Promise((resolve, failure) => { settle = resolve; reject = failure })
      },
      async disconnect() { session = undefined; localStorage.removeItem('saffron.fixture.wc-session'); emit('disconnect') },
    }
    provider.signer = provider
    window.fixtureWalletConnect = { options, async approve() {
      const [address] = await provider.request({ method: 'eth_requestAccounts' })
      session = { topic: crypto.randomUUID(), expiry: Date.now() / 1000 + 86400 * 7,
        namespaces: { eip155: { accounts: ['eip155:4663:' + address], methods: options.optionalMethods, events: options.optionalEvents } } }
      localStorage.setItem('saffron.fixture.wc-session', JSON.stringify(session)); settle()
    }, reject() { reject(new Error('User rejected connection')) } }
    return provider
  }
}
