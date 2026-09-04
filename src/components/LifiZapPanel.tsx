import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, getAddress, type Address, type Hash } from 'viem'

import { clientFor } from '../chain/clients'
import type { FixedVault, FixedVaultToken } from '../fixedVaults/model'
import { shortAddr } from '../lib/format'
import { requestZapQuote } from '../zap/api'
import { prepareZap } from '../zap/calls'
import { ZAP_CHAIN_CONFIG, ZAP_QUOTE_MAX_AGE_MS } from '../zap/config'
import { executeZap, revokeZapAllowance } from '../zap/execute'
import type {
  PreparedZap,
  ZapExecutionStep,
  ZapQuote,
} from '../zap/types'
import { validateZapQuote } from '../zap/validate'
import lifiLogo from '../zap/assets/lifi-logo.svg'
import { erc20Abi } from '../chain/abis'

import { TokenLogo } from './TokenIcon'

const STEP_LABELS: Record<ZapExecutionStep, string> = {
  checking: 'Checking wallet and route…',
  'resetting-allowance': 'Reset the existing allowance in your wallet…',
  approving: 'Approve the exact LI.FI amount in your wallet…',
  'refreshing-quote': 'Refreshing the route after approval…',
  simulating: 'Simulating the complete deposit…',
  sending: 'Confirm the LI.FI zap in your wallet…',
  confirming: 'Waiting for the zap to confirm…',
}

function displayAmount(value: bigint, decimals: number): string {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
  const visible = fraction.slice(0, 6).replace(/0+$/, '')
  return visible ? `${whole}.${visible}` : whole
}

function estimatedUsdCost(quote: ZapQuote): string | undefined {
  const costs = [...(quote.estimate?.gasCosts ?? []), ...(quote.estimate?.feeCosts ?? [])]
    .map((cost) => Number(cost.amountUSD))
    .filter((cost) => Number.isFinite(cost) && cost >= 0)
  if (!costs.length) return undefined
  return `$${costs.reduce((sum, value) => sum + value, 0).toFixed(2)}`
}

function cleanError(error: unknown): string {
  const message = (error as Error)?.message ?? String(error)
  if (/User rejected|user denied|rejected the request|ACTION_REJECTED/i.test(message)) {
    return 'You rejected the request in your wallet.'
  }
  if (/insufficient funds/i.test(message)) return 'Insufficient funds for gas.'
  return message.split('\n')[0].slice(0, 180)
}

/**
 * Minimal direct-source LI.FI panel. Users choose token0 or token1; the app
 * builds the other leg and fixed deposit atomically without introducing the
 * branch's still-unverified arbitrary-token or cross-chain paths.
 */
export function LifiZapPanel({
  vault,
  account,
  slippageBps,
  onSlippageBpsChange,
  previewOnly,
  onConnect,
  onBusyChange,
  onSuccess,
}: {
  vault: FixedVault
  account: string | null
  slippageBps: number
  onSlippageBpsChange: (slippageBps: number) => void
  previewOnly: boolean
  onConnect: () => void | Promise<void>
  onBusyChange: (busy: boolean) => void
  onSuccess: () => void | Promise<void>
}) {
  const [selectedAddress, setSelectedAddress] = useState(vault.token0.address)
  const [prepared, setPrepared] = useState<PreparedZap>()
  const [quote, setQuote] = useState<ZapQuote>()
  const [quoteReceivedAt, setQuoteReceivedAt] = useState<number>()
  const [balance, setBalance] = useState<bigint>()
  const [connectingWallet, setConnectingWallet] = useState(false)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [step, setStep] = useState<ZapExecutionStep>()
  const [error, setError] = useState<string>()
  const [txHash, setTxHash] = useState<Hash>()
  const [approvalHash, setApprovalHash] = useState<Hash>()
  const [leftoverAllowance, setLeftoverAllowance] = useState(0n)
  const [revoking, setRevoking] = useState(false)
  const [revokeHash, setRevokeHash] = useState<Hash>()
  const [positionObserved, setPositionObserved] = useState(true)
  const [clock, setClock] = useState(Date.now())
  const selected = useMemo(
    () =>
      [vault.token0, vault.token1].find(
        (token) => token.address.toLowerCase() === selectedAddress.toLowerCase(),
      ) ?? vault.token0,
    [selectedAddress, vault.token0, vault.token1],
  )
  const busy = connectingWallet || loadingQuote || step !== undefined || revoking

  const resetQuote = useCallback(() => {
    setPrepared(undefined)
    setQuote(undefined)
    setQuoteReceivedAt(undefined)
    setBalance(undefined)
    setError(undefined)
    setTxHash(undefined)
    setApprovalHash(undefined)
    setLeftoverAllowance(0n)
    setRevokeHash(undefined)
    setPositionObserved(true)
  }, [])

  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  useEffect(() => {
    if (!quoteReceivedAt || !quote) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [quote, quoteReceivedAt])

  useEffect(() => {
    // A quote binds both its transaction sender and refund receiver. Drop all
    // wallet-specific state immediately if the injected account changes.
    resetQuote()
  }, [account, resetQuote])

  function selectToken(token: FixedVaultToken) {
    if (busy || txHash) return
    setSelectedAddress(token.address)
    resetQuote()
  }

  function selectSlippage(nextSlippageBps: number) {
    if (busy || txHash || nextSlippageBps === slippageBps) return
    onSlippageBpsChange(nextSlippageBps)
    // Slippage is encoded in both the local deposit floor and LI.FI request,
    // so an existing quote must never survive a tolerance change.
    resetQuote()
  }

  async function loadBalance(token: Address, owner: Address): Promise<bigint> {
    const client = clientFor(vault.chainKey)
    if (!client) throw new Error(`${vault.chainLabel} RPC is unavailable`)
    return client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>
  }

  async function connectWallet() {
    setConnectingWallet(true)
    setError(undefined)
    try {
      await onConnect()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setConnectingWallet(false)
    }
  }

  async function quoteZap() {
    if (!account) {
      await connectWallet()
      return
    }
    setLoadingQuote(true)
    setError(undefined)
    setTxHash(undefined)
    setLeftoverAllowance(0n)
    try {
      const owner = getAddress(account)
      const nextPrepared = await prepareZap(
        vault,
        getAddress(selected.address),
        owner,
        slippageBps,
      )
      const [nextQuote, nextBalance] = await Promise.all([
        requestZapQuote(nextPrepared.request),
        loadBalance(nextPrepared.plan.deliverToken, owner),
      ])
      validateZapQuote(nextPrepared.request, nextQuote)
      setPrepared(nextPrepared)
      setQuote(nextQuote)
      setBalance(nextBalance)
      setQuoteReceivedAt(Date.now())
      setClock(Date.now())
    } catch (cause) {
      setPrepared(undefined)
      setQuote(undefined)
      setQuoteReceivedAt(undefined)
      setError(cleanError(cause))
    } finally {
      setLoadingQuote(false)
    }
  }

  async function submitZap() {
    if (!account || !prepared || !quote || !quoteReceivedAt) return
    const expired = Date.now() - quoteReceivedAt > ZAP_QUOTE_MAX_AGE_MS
    if (expired) {
      await quoteZap()
      return
    }
    setError(undefined)
    try {
      const result = await executeZap({
        vault,
        account: getAddress(account),
        prepared,
        quote,
        quoteReceivedAt,
        onStep: setStep,
        onApprovalHash: (hash, amount) => {
          setApprovalHash(hash)
          // Assume a submitted approval can land until the final onchain read
          // proves otherwise. This leaves the revoke action available after a
          // failed quote refresh or transaction preflight.
          setLeftoverAllowance(amount)
        },
        onZapHash: setTxHash,
      })
      setTxHash(result.hash)
      setLeftoverAllowance(result.leftoverAllowance)
      setPositionObserved(result.positionObserved)
      await onSuccess()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setStep(undefined)
    }
  }

  async function revokeAllowance() {
    if (!account || !prepared) return
    setRevoking(true)
    setError(undefined)
    try {
      const hash = await revokeZapAllowance({
        vault,
        account: getAddress(account),
        token: prepared.plan.deliverToken,
        spender: ZAP_CHAIN_CONFIG[prepared.request.fromChain].lifiApproval,
        onHash: setRevokeHash,
      })
      setRevokeHash(hash)
      setLeftoverAllowance(0n)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setRevoking(false)
    }
  }

  const requiredAmount = quote?.estimate?.fromAmount
    ? BigInt(quote.estimate.fromAmount)
    : prepared?.plan.deliverAmount
  const shortfall =
    requiredAmount !== undefined && balance !== undefined && requiredAmount > balance
      ? requiredAmount - balance
      : 0n
  const secondsRemaining = quoteReceivedAt
    ? Math.max(0, Math.ceil((ZAP_QUOTE_MAX_AGE_MS - (clock - quoteReceivedAt)) / 1_000))
    : 0
  const routeCost = quote ? estimatedUsdCost(quote) : undefined
  const routeTools = [
    ...new Set(
      quote?.includedSteps
        ?.map((item) => item.tool)
        .filter((tool): tool is string => !!tool && tool !== 'custom') ?? [],
    ),
  ].join(' → ')

  if (previewOnly) {
    return (
      <div className="lifi-zap-panel">
        <ZapHeader chainLabel={vault.chainLabel} />
        <p className="lifi-zap-help">
          The live app lets a connected wallet fund this fixed position with either vault token.
        </p>
        <div className="fdm-preview-notice">
          Static preview — no LI.FI quote, RPC, wallet, or transaction request is made.
        </div>
      </div>
    )
  }

  return (
    <div className="lifi-zap-panel">
      <ZapHeader chainLabel={vault.chainLabel} />
      <p className="lifi-zap-help">
        Choose one vault token. LI.FI swaps the second leg and deposits the complete fixed
        position in one transaction.
      </p>

      <span className="lifi-zap-label">Pay with</span>
      <div className="lifi-zap-token-grid" role="group" aria-label="Zap source token">
        {[vault.token0, vault.token1].map((token) => {
          const selectedToken = token.address.toLowerCase() === selected.address.toLowerCase()
          return (
            <button
              key={token.address}
              type="button"
              className={selectedToken ? 'selected' : ''}
              aria-pressed={selectedToken}
              disabled={busy || !!txHash}
              onClick={() => selectToken(token)}
            >
              <TokenLogo
                chainId={vault.chainId}
                address={token.address}
                symbol={token.symbol}
                size={24}
              />
              <span>{token.symbol}</span>
            </button>
          )
        })}
      </div>
      <p className="lifi-zap-token-note">
        ERC-20 only in this minimal flow. Choose WETH when the pair includes wrapped ETH.
      </p>

      <div className="fdm-slippage-row lifi-zap-slippage">
        <span className="fdm-slippage-label">Max slippage</span>
        <div className="fdm-slippage-options" role="group" aria-label="Zap slippage tolerance">
          {[10, 50, 100].map((bps) => (
            <button
              key={bps}
              type="button"
              className={slippageBps === bps ? 'selected' : ''}
              aria-pressed={slippageBps === bps}
              disabled={busy || !!txHash}
              onClick={() => selectSlippage(bps)}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      {quote && prepared && (
        <div className="lifi-zap-summary">
          <div>
            <span>Required</span>
            <b>
              {requiredAmount === undefined
                ? '—'
                : `~${displayAmount(requiredAmount, selected.decimals)}`}{' '}
              {selected.symbol}
            </b>
          </div>
          <div>
            <span>Wallet balance</span>
            <b>
              {balance === undefined ? '—' : displayAmount(balance, selected.decimals)}{' '}
              {selected.symbol}
            </b>
          </div>
          <div>
            <span>Internal swap</span>
            <b>~{displayAmount(prepared.plan.swapAmount, selected.decimals)} {selected.symbol}</b>
          </div>
          <div>
            <span>Estimated cost</span>
            <b>{routeCost ?? 'Shown in wallet'}</b>
          </div>
          <small>Route: {routeTools || 'LI.FI contract calls'}</small>
          <small className={secondsRemaining === 0 ? 'expired' : ''}>
            {secondsRemaining === 0
              ? 'Quote expired — refresh before continuing'
              : `Quote valid for ${secondsRemaining}s`}
          </small>
        </div>
      )}

      {shortfall > 0n && (
        <div className="dm-error">
          Add {displayAmount(shortfall, selected.decimals)} {selected.symbol} or deposit both tokens.
        </div>
      )}
      {step && <div className="dm-status"><span className="spin" /> {STEP_LABELS[step]}</div>}
      {error && <div className="dm-error" role="alert">⚠ {error}</div>}
      {approvalHash && (
        <a className="dm-tx" href={`${vault.explorer}/tx/${approvalHash}`} target="_blank" rel="noreferrer">
          View approval {shortAddr(approvalHash)} ↗
        </a>
      )}
      {txHash && (
        <>
          <div className="lifi-zap-success" role="status">
            Zap confirmed.{positionObserved ? ' Your fixed position is ready.' : ' Refresh to view the position.'}
          </div>
          <a className="dm-tx" href={`${vault.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
            View zap {shortAddr(txHash)} ↗
          </a>
        </>
      )}
      {leftoverAllowance > 0n && prepared && (
        <div className="lifi-zap-cleanup">
          <span>
            A {displayAmount(leftoverAllowance, selected.decimals)} {selected.symbol} LI.FI allowance
            remains from this or an earlier session.
          </span>
          <button type="button" onClick={() => void revokeAllowance()} disabled={revoking}>
            {revoking ? 'Revoking…' : 'Revoke allowance'}
          </button>
        </div>
      )}
      {revokeHash && (
        <a className="dm-tx" href={`${vault.explorer}/tx/${revokeHash}`} target="_blank" rel="noreferrer">
          Allowance revoked {shortAddr(revokeHash)} ↗
        </a>
      )}

      {!account ? (
        <button
          className="dm-cta fdm-confirm-cta"
          type="button"
          disabled={connectingWallet}
          onClick={() => void connectWallet()}
        >
          {connectingWallet ? 'Connecting…' : 'Connect wallet'}
        </button>
      ) : txHash ? null : quote ? (
        <button
          className="dm-cta fdm-confirm-cta"
          type="button"
          disabled={busy || shortfall > 0n || balance === undefined}
          onClick={() => void submitZap()}
        >
          {step
            ? STEP_LABELS[step]
            : secondsRemaining === 0
              ? 'Refresh zap quote'
              : shortfall > 0n
                ? 'Insufficient balance'
                : 'Review and confirm zap'}
        </button>
      ) : (
        <button
          className="dm-cta fdm-confirm-cta"
          type="button"
          disabled={busy}
          onClick={() => void quoteZap()}
        >
          {loadingQuote ? 'Finding LI.FI route…' : 'Get zap quote'}
        </button>
      )}
      <p className="lifi-zap-footnote">
        The quote is same-chain and bound to this vault. Any ERC-20 approval is exact and finite;
        every destination call is checked again before submission.
      </p>
    </div>
  )
}

function ZapHeader({ chainLabel }: { chainLabel: string }) {
  return (
    <div className="lifi-zap-header">
      <div>
        <b>One token in, fixed position out</b>
        <span>{chainLabel}</span>
      </div>
      <div className="lifi-zap-brand" aria-label="Powered by LI.FI">
        <img src={lifiLogo} alt="" />
        <span>LI.FI</span>
      </div>
    </div>
  )
}
