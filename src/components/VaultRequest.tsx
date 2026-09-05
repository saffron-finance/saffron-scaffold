import { useEffect, useState } from 'react'
import { parseUnits, type Address, type Hash } from 'viem'
import { arbitrum } from 'viem/chains'
import { ensureChain, walletClient, walletPublicClient } from '../wallet/wallet'

interface PaymentConfig {
  enabled: boolean
  chainId: number
  chainLabel: string
  token: Address
  tokenSymbol: string
  tokenDecimals: number
  amount: string
  recipient?: Address
}

const transferAbi = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }],
}] as const

export function VaultRequest({ account, onConnect }: {
  account: Address | null
  onConnect: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<PaymentConfig | null>(null)
  const [chain, setChain] = useState('arbitrum')
  const [depositToken, setDepositToken] = useState('')
  const [pair, setPair] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'idle' | 'paying' | 'confirming' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void fetch(new URL('vault-requests/config', document.baseURI))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then(setConfig)
      .catch(() => setError('Vault requests are temporarily unavailable.'))
  }, [open])

  const busy = step !== 'idle' && step !== 'done'
  const valid = depositToken.trim() && pair.trim() && Number(amount) > 0

  async function submit() {
    if (!account) return void onConnect()
    if (!config?.enabled || !config.recipient) return
    setError(null)
    try {
      setStep('paying')
      await ensureChain(arbitrum)
      const hash = await walletClient().writeContract({
        account,
        chain: arbitrum,
        address: config.token,
        abi: transferAbi,
        functionName: 'transfer',
        args: [config.recipient, parseUnits(config.amount, config.tokenDecimals)],
      })
      setStep('confirming')
      await walletPublicClient(arbitrum).waitForTransactionReceipt({ hash })
      setStep('saving')
      const response = await fetch(new URL('vault-requests', document.baseURI), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: account, chain, depositToken, pair, depositAmount: amount, paymentTxHash: hash as Hash }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Request could not be recorded.')
      setRequestId(result.id)
      setStep('done')
    } catch (cause) {
      const message = String((cause as Error)?.message ?? cause)
      setError(/rejected|denied/i.test(message) ? 'Payment was cancelled in your wallet.' : message.split('\n')[0].slice(0, 180))
      setStep('idle')
    }
  }

  return (
    <div className="vault-request">
      {!open ? (
        <><div><b>Don’t see the vault you need?</b><span>Send Saffron a paid deposit request so an operator can deploy it.</span></div><button onClick={() => setOpen(true)}>Request a vault · $2</button></>
      ) : (
        <div className="vault-request-form">
          <div className="vault-request-heading"><div><b>Request a vault</b><span>Your request enters the operator queue after a $2 USDC payment.</span></div><button aria-label="Close request form" onClick={() => setOpen(false)} disabled={busy}>×</button></div>
          <div className="vault-request-fields">
            <label>Network<select value={chain} onChange={(e) => setChain(e.target.value)} disabled={busy}><option value="ethereum">Ethereum</option><option value="arbitrum">Arbitrum</option><option value="robinhood">Robinhood Chain</option></select></label>
            <label>Deposit token<input placeholder="USDC or 0x…" value={depositToken} onChange={(e) => setDepositToken(e.target.value)} disabled={busy} /></label>
            <label>Desired yield pair<input placeholder="WETH / USDC" value={pair} onChange={(e) => setPair(e.target.value)} disabled={busy} /></label>
            <label>Amount waiting to deposit<input inputMode="decimal" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} disabled={busy} /></label>
          </div>
          {step === 'done' ? <div className="vault-request-success">✓ Request {requestId} is paid and waiting for a vault. Saffron can now review and deploy it.</div> : (
            <button className="vault-request-pay" disabled={!valid || busy || !config?.enabled} onClick={() => void submit()}>
              {!account ? 'Connect wallet' : busy ? ({ paying: 'Confirm $2 USDC payment…', confirming: 'Confirming payment…', saving: 'Adding to deployment queue…' }[step] ?? 'Working…') : 'Pay $2 USDC & request vault'}
            </button>
          )}
          {config && !config.enabled && <div className="vault-request-error">Payment collection is not configured yet.</div>}
          {error && <div className="vault-request-error">⚠ {error}</div>}
          <small>Payment is collected on Arbitrum. Paying creates a request; it does not guarantee deployment.</small>
        </div>
      )}
    </div>
  )
}
