import { useEffect, useRef, useState } from 'react'
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, formatUnits, type Address, type Hex } from 'viem'
import { walletClient, walletPublicClient, assertWalletAccount, ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { abi, WETH, eligibility, sameAddress } from '../../shared/vault-lifecycle.mjs'
import { amountsForLiquidity, ceilDiv } from '../../shared/liquidity-math.mjs'
import { robinhoodClient, requestJson, authedJson, readSession } from './transport'
import { positionAction } from '../../shared/position-actions.mjs'
import { campaignFundingTerms,campaignFundingAction,fundingStorageKey,campaignWithdrawalStorageKey,campaignWithdrawalQuote } from './campaignFunding'

type Intent = { stage: string; account: Address; deploymentId: string; to: Address; data: Hex; value: string; nonce: number; hash?: Hex }
export const positionStorageKey = (account: string, deploymentId: string) => 'saffron.position-action.v1:' + account.toLowerCase() + ':' + deploymentId
const rejected = (cause: unknown): boolean => {
  let current = cause as { code?: number; cause?: unknown } | undefined
  for (let i = 0; current && i < 8; i++, current = current.cause as typeof current) if (current.code === 4001) return true
  return false
}

/** Wallet-only position/funding controller. Durable intent precedes a wallet
 * prompt; lost responses never become permission to send a second transaction.
 * Admin variable funding shares recovery, but has separate role-gated context
 * and storage from the requester's fixed position.
 */
export function useVaultPosition(account: Address, deploymentId: string, mode: string) {
  const adminMode=mode==='fund'||mode==='campaign-withdraw'
  const contextPath='/admin/deployments/'+deploymentId+(mode==='campaign-withdraw'?'/withdrawal-context':'/funding-context')
  const key = mode==='campaign-withdraw'?campaignWithdrawalStorageKey(account,deploymentId):mode==='fund'?fundingStorageKey(account,deploymentId):positionStorageKey(account, deploymentId)
  const [context, setContext] = useState<any>(null)
  const [quote, setQuote] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const foregroundState = useRef<() => void>(() => {})
  const [pending, setPending] = useState<Intent | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null')
      return value?.account?.toLowerCase() === account.toLowerCase() && value.deploymentId === deploymentId ? value : null
    } catch { return null }
  })
  function persist(value: Intent | null) {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
    setPending(value)
  }
  async function load() {
    if(adminMode){
      // Never trigger a surprise login signature on a background refresh.
      if(!(await readSession(account))?.operator)throw new Error('Sign in as an operator before continuing.')
      const value=await authedJson(account,contextPath)
      if(!sameAddress(value.funder,account))throw new Error('The signed-in funding wallet changed.')
      setContext(value)
      if(mode==='campaign-withdraw'){
        const fresh=campaignWithdrawalQuote(value);setQuote(fresh);setError(null);return fresh
      }
      const terms=campaignFundingTerms(value.deployment)
      const [balance,allowance]=await Promise.all([
        robinhoodClient.readContract({address:terms.token.address,abi,functionName:'balanceOf',args:[account]}) as Promise<bigint>,
        robinhoodClient.readContract({address:terms.token.address,abi,functionName:'allowance',args:[account,terms.vault]}) as Promise<bigint>,
      ])
      const blocked=balance<terms.remaining?'Insufficient '+terms.token.symbol+' in your connected wallet.':null
      const fresh={phase:null,snapshot:value.snapshot,tokens:[terms.token],rawAmounts:[terms.remaining],maximums:[terms.remaining],
        action:campaignFundingAction(terms,allowance),blocked}
      setQuote(fresh);setError(blocked);return fresh
    }
    const value = await requestJson('/deployments/' + deploymentId + '/context')
    // The context endpoint freshly reads the trusted-factory vault and this
    // viewer's balances. Do not repeat that entire observation in the browser.
    const snapshot = value.snapshot
    if(eligibility(snapshot).state==='checking')throw new Error('Position state is unavailable. Refresh before continuing.')
    setContext({...value,snapshot})
    if(mode==='view'){setQuote(null);return null}
    if(mode!=='deposit'){
      const action=positionAction(snapshot,mode)
      const fresh={phase:null,snapshot,tokens:[snapshot.token0,snapshot.token1],rawAmounts:action.amounts??[0n,0n],maximums:action.amounts??[0n,0n],action,blocked:null}
      setQuote(fresh);setError(null);return fresh
    }
    if (!value.deployment.depositable || !eligibility(snapshot).depositable) throw new Error('Vault funding or availability changed.')
    const amounts = amountsForLiquidity(snapshot.liquidity,snapshot.sqrtPrice,snapshot.minTick,snapshot.maxTick)
    const tokens = [snapshot.token0,snapshot.token1]
    const rawAmounts = [amounts.amount0,amounts.amount1]
    const [balances, allowances, native] = await Promise.all([
      Promise.all(tokens.map(token => robinhoodClient.readContract({ address: token.address,abi,functionName:'balanceOf',args:[account] }) as Promise<bigint>)),
      Promise.all(tokens.map(token => robinhoodClient.readContract({ address: token.address,abi,functionName:'allowance',args:[account,snapshot.adapter] }) as Promise<bigint>)),
      robinhoodClient.getBalance({address:account}),
    ])
    // A 0.5% explicit token-spend envelope, not an unlimited approval.
    const maximums = rawAmounts.map(amount => ceilDiv(amount * 10050n,10000n))
    let blocked: string | null = null
    let action: {stage:string;label:string;to:Address;data:Hex;value:bigint} | null = null
    for (let i=0;i<tokens.length;i++) {
      if (balances[i] < maximums[i]) {
        const missing=maximums[i]-balances[i]
        if (sameAddress(tokens[i].address,WETH) && native > missing) {
          action ??= {stage:'wrap',label:'Wrap ETH',to:WETH,data:encodeFunctionData({abi,functionName:'deposit',args:[]}),value:missing}
        } else blocked = 'Insufficient ' + tokens[i].symbol + ' for the current LP amounts and 0.5% buffer.'
      }
    }
    if (!action) for (let i=0;i<tokens.length;i++) {
      if (allowances[i]<maximums[i]) {
        const reset=allowances[i]>0n
        action = {stage:'approve-'+i,label:(reset?'Reset ':'Approve ')+tokens[i].symbol,to:tokens[i].address,
          data:encodeFunctionData({abi,functionName:'approve',args:[snapshot.adapter,reset?0n:maximums[i]]}),value:0n}
        break
      }
    }
    const data = encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],
      [rawAmounts[0]*9950n/10000n,rawAmounts[1]*9950n/10000n,BigInt(snapshot.headTimestamp+300)])
    action ??= {stage:'deposit',label:'Deposit',to:snapshot.vault,data:encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,data]}),value:0n}
    const fresh={phase:null,snapshot,tokens,rawAmounts,maximums,action,blocked}
    setContext(value);setQuote(fresh);setError(blocked)
    return fresh
  }
  async function refresh() {
    setError(null);setQuote(null)
    try { await load() } catch(cause) { setQuote(null);setError(cause instanceof Error?cause.message:'Deposit unavailable.') }
  }
  useEffect(()=>{ void refresh() },[account,deploymentId,mode])
  foregroundState.current=()=>{
    if(busy||completed||document.hidden)return
    // A return is permission to read evidence, never to submit a wallet action.
    if(pending?.hash)void recover()
    else void refresh()
  }
  useEffect(()=>{
    const resume=()=>foregroundState.current()
    window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume)
    return()=>{window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}
  },[])

  async function confirm(intent: Intent) {
    if (!intent.hash || !/^0x[0-9a-fA-F]{64}$/.test(intent.hash)) throw new Error('Enter the transaction hash from your wallet to recover.')
    let hash=intent.hash
    const receipt=await robinhoodClient.waitForTransactionReceipt({hash,confirmations:2,timeout:60_000,
      onReplaced: replacement=>{ hash=replacement.transaction.hash;persist({...intent,hash}) }})
    const [tx,block]=await Promise.all([robinhoodClient.getTransaction({hash}),robinhoodClient.getBlock({blockNumber:receipt.blockNumber})])
    if (block.hash!==receipt.blockHash) throw new Error('Transaction block changed. Keep this recovery record.')
    const expected=sameAddress(tx.from,account)&&sameAddress(tx.to,intent.to)&&tx.input===intent.data&&tx.value===BigInt(intent.value)&&tx.nonce===intent.nonce
    if (!expected) {
      const cancelled=sameAddress(tx.from,account)&&sameAddress(tx.to,account)&&tx.value===0n&&tx.input==='0x'&&receipt.logs.length===0&&tx.nonce===intent.nonce
      if (cancelled) persist(null)
      throw new Error(cancelled?'Wallet transaction was cancelled.':'Replacement does not match the reviewed action; recovery retained.')
    }
    if (receipt.status!=='success') {persist(null);throw new Error('Transaction reverted. Refresh the amounts before retrying.')}
    if (intent.stage === 'deposit' || intent.stage === 'fund') {
      const deposited = receipt.logs.some(log => {
        if (!sameAddress(log.address, intent.to) || log.removed) return false
        try { const event = decodeEventLog({abi, data:log.data, topics:log.topics}); return event.eventName === 'FundsDeposited' && (event.args as any).side === (intent.stage==='fund'?1n:0n) && sameAddress((event.args as any).user, account) } catch { return false }
      })
      if (!deposited) throw new Error('Expected deposit event not found. Recovery retained.')
    }
    if(intent.stage==='campaign-withdraw'){
      const withdrew=receipt.logs.some(log=>{
        if(!sameAddress(log.address,intent.to)||log.removed)return false
        try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});return event.eventName==='FundsWithdrawn'&&(event.args as any).side===1n&&sameAddress((event.args as any).user,account)}catch{return false}
      })
      if(!withdrew)throw new Error('Expected variable-side withdrawal event not found. Recovery retained.')
    }
    if(['deposit','claim','withdraw','recover'].includes(intent.stage))await requestJson('/deployments/'+deploymentId+'/transactions',{hash,wallet:account})
    persist(null)
    if(['deposit','claim','withdraw','recover','fund','campaign-withdraw'].includes(intent.stage)){
      setCompleted(true);setQuote(null)
      // A successful funding receipt is final for this wallet action. Refresh
      // the observer without ever turning a failed refresh into a second send.
      if(['fund','campaign-withdraw'].includes(intent.stage))try{setContext(await authedJson(account,contextPath))}
      catch{setError('Wallet transaction confirmed. Refresh operations to update the vault status.')}
      window.dispatchEvent(new Event('saffron:vault-updated'))
    }
    else await refresh()
  }
  async function recover(hash?: Hex) {
    if(!pending)return
    setBusy(true);setError(null)
    try {await assertWalletAccount(account);const intent={...pending,...(hash?{hash}:{})};persist(intent);await confirm(intent)}
    catch(cause){setError(cause instanceof Error?cause.message:'Recovery check failed. Record retained.')}
    finally{setBusy(false)}
  }
  async function sendAction() {
    setBusy(true);setError(null)
    try {
      if(adminMode&&localStorage.getItem(mode==='fund'?campaignWithdrawalStorageKey(account,deploymentId):fundingStorageKey(account,deploymentId)))throw new Error('Recover the previous campaign wallet action before starting another.')
      const stored=localStorage.getItem(key)
      if(pending){await recover();return}
      if(stored){
        const intent=JSON.parse(stored)
        if(!sameAddress(intent?.account,account)||intent.deploymentId!==deploymentId||!Number.isSafeInteger(intent.nonce)||intent.nonce<0)throw new Error('Saved wallet action cannot be read. Preserve its record and recover the original transaction before continuing.')
        setPending(intent);return
      }
      await assertWalletAccount(account);await ensureChain(robinhoodChain)
      // A captured review is required for funding; opening/reloading a modal
      // cannot itself authorize a transaction, even if the context later loads.
      if(adminMode&&!quote)throw new Error('Refresh and review the wallet action first.')
      const fresh=await load()
      if(!fresh?.action)throw new Error('This position has no available wallet action.')
      if(fresh.blocked) throw new Error(fresh.blocked)
      if(quote && (fresh.action.stage!==quote.action.stage || fresh.action.stage==='deposit'&&fresh.rawAmounts.some((value:bigint,i:number)=>value>quote.maximums[i])
        || adminMode&&(fresh.action.to.toLowerCase()!==quote.action.to.toLowerCase()||fresh.action.data!==quote.action.data||fresh.rawAmounts[0]!==quote.rawAmounts[0]||fresh.phase!==quote.phase))) {
        throw new Error('Required action or amounts changed. Review the updated modal before continuing.')
      }
      const action=fresh.action
      // Gas simulation uses only the selected wallet, never the read-only relay.
      await walletPublicClient(robinhoodChain).estimateGas({account,to:action.to,data:action.data,value:action.value})
      await assertWalletAccount(account)
      // Bind recovery to this nonce, not an older identical wrap/approval hash.
      const nonce = await walletPublicClient(robinhoodChain).getTransactionCount({address:account,blockTag:'pending'})
      // Simulation/wallet-network work can outlive a program pause. Refresh its
      // authoritative policy and ownership again immediately before prompting.
      if(mode==='campaign-withdraw'){
        const latest=await load()
        if(!latest||latest.phase!==fresh.phase||latest.rawAmounts[0]!==fresh.rawAmounts[0])throw new Error('Withdrawal changed. Review the updated modal before continuing.')
        await assertWalletAccount(account)
      }
      const intent:Intent={stage:action.stage,account,deploymentId,to:action.to,data:action.data,value:action.value.toString(),nonce}
      persist(intent)
      let hash:Hex
      try {hash=await walletClient().sendTransaction({chain:robinhoodChain,account,to:action.to,data:action.data,value:action.value,nonce})}
      catch(cause){if(rejected(cause))persist(null);throw cause}
      const saved={...intent,hash};persist(saved);await confirm(saved)
    }catch(cause){if(mode==='campaign-withdraw')setQuote(null);setError(cause instanceof Error?cause.message:'Wallet action failed. Check recovery before retrying.')}
    finally{setBusy(false)}
  }
  async function advance(){
    if(!navigator.locks){setError('This browser cannot coordinate wallet actions safely. Use a browser with Web Locks support.');return}
    await navigator.locks.request('saffron.wallet-action:'+account.toLowerCase(),{ifAvailable:true},async lock=>{
      if(!lock){setError('Another Saffron wallet action is in progress. Finish it before continuing.');return}
      await sendAction()
    })
  }
  return {context,quote,error,busy,completed,pending,refresh,advance,recover,
    amountLabel:(i:number)=>quote?formatUnits(quote.rawAmounts[i],quote.tokens[i].decimals):'—'}
}
