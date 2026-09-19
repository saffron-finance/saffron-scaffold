import { useEffect, useRef, useState } from 'react'
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, formatUnits, type Address, type Hex } from 'viem'
import { walletClient, walletPublicClient, assertWalletAccount, ensureChain, selectedWalletProviderId } from '@lab/wallet/wallet'
import { WalletPreflight } from '@lab/wallet/preflight'
import { robinhoodChain } from '@lab/chain/chains'
import { abi, WETH, eligibility, sameAddress } from '../../shared/vault-lifecycle.mjs'
import { amountsForLiquidity, ceilDiv } from '../../shared/liquidity-math.mjs'
import { robinhoodClient, requestJson, authedJson, readSession } from './transport'
import { positionAction } from '../../shared/position-actions.mjs'
import { programFundingTerms,programFundingAction,fundingStorageKey,programWithdrawalStorageKey,programWithdrawalQuote } from './programFunding'

import { readIntentRecord,writeIntentRecord,intentIdentity,intentChanged,type Intent,type IntentRecord } from './position-intent'
type Operation = {scope:WalletPreflight;submitted:boolean}
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
  const key = mode==='campaign-withdraw'?programWithdrawalStorageKey(account,deploymentId):mode==='fund'?fundingStorageKey(account,deploymentId):positionStorageKey(account, deploymentId)
  const [context, setContext] = useState<any>(null)
  const [quote, setQuote] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Preparing reads can be cancelled. Only an actual send/recovery blocks
  // closing; busy still disables duplicate action buttons during preparation.
  const [closeBlocked, setCloseBlocked] = useState(false)
  const identity = account.toLowerCase()+':'+deploymentId+':'+mode
  // A finite reviewed envelope survives approval confirmations and background
  // price refreshes. It is scoped to the wallet, vault, adapter and tokens.
  const spendEnvelope=useRef<{key:string;maximums:bigint[]}|null>(null)
  const view = useRef(identity);view.current=identity
  const mounted = useRef(true)
  const operation = useRef<Operation|null>(null)
  const refreshing = useRef<WalletPreflight|null>(null)
  const isVisible = () => mounted.current && view.current===identity
  const cancelPreflight = () => {
    if(operation.current&&!operation.current.submitted)operation.current.scope.cancel()
    refreshing.current?.cancel()
  }
  const [completed, setCompleted] = useState(false)
  const foregroundState = useRef<() => void>(() => {})
  const refreshCurrent = useRef<() => void>(() => {})
  const [pending, setPending] = useState<Intent | null>(() => {
    try { return readIntentRecord(key,account,deploymentId).value } catch { return null }
  })
  function persist(value: Intent | null, previous: IntentRecord) {
    const saved=writeIntentRecord(key,previous,value)
    if(isVisible())setPending(value)
    return saved
  }
  useEffect(()=>{
    const sync=()=>{
      try {
        const current=readIntentRecord(key,account,deploymentId).value
        setPending(current)
        // A different tab may have advanced the action. Do not infer completion
        // or send anything from a storage notification; refresh read-only state.
        if(!operation.current){setCompleted(false);void refresh()}
      }catch(cause){setError(cause instanceof Error?cause.message:'Saved action is unavailable.')}
    }
    const changed=(event:StorageEvent)=>{if(event.storageArea===localStorage&&(event.key===key||event.key===null))sync()}
    const local=(event:Event)=>{if((event as CustomEvent).detail===key)sync()}
    try{setPending(readIntentRecord(key,account,deploymentId).value)}catch{/* An action surfaces the malformed record without deleting it. */}
    window.addEventListener('storage',changed);window.addEventListener('saffron:position-action',local)
    return()=>{window.removeEventListener('storage',changed);window.removeEventListener('saffron:position-action',local)}
  },[key])
  async function load(scope?: WalletPreflight) {
    // Guard both network continuations and their UI updates. A late context
    // response from a closed/replaced review cannot overwrite the new review.
    const read = <T>(work:()=>Promise<T>) => scope ? scope.read(work) : work()
    if(adminMode){
      // Never trigger a surprise login signature on a background refresh.
      if(!(await read(()=>readSession(account)))?.operator)throw new Error('Sign in as an operator before continuing.')
      // The fresh session above is sufficient for this authenticated GET.
      // Do not use the login-capable helper inside cancellable preflight work.
      const value=await read(()=>requestJson(contextPath))
      scope?.assertActive()
      if(!sameAddress(value.funder,account))throw new Error('The signed-in funding wallet changed.')
      setContext(value)
      if(mode==='campaign-withdraw'){
        const fresh=programWithdrawalQuote(value);setQuote(fresh);setError(null);return fresh
      }
      const terms=programFundingTerms(value.deployment)
      const [balance,allowance]=await read(()=>Promise.all([
        robinhoodClient.readContract({address:terms.token.address,abi,functionName:'balanceOf',args:[account]}) as Promise<bigint>,
        robinhoodClient.readContract({address:terms.token.address,abi,functionName:'allowance',args:[account,terms.vault]}) as Promise<bigint>,
      ]))
      scope?.assertActive()
      const blocked=balance<terms.remaining?'Insufficient '+terms.token.symbol+' in your connected wallet.':null
      const fresh={phase:null,snapshot:value.snapshot,tokens:[terms.token],rawAmounts:[terms.remaining],maximums:[terms.remaining],
        action:programFundingAction(terms,allowance),blocked}
      setQuote(fresh);setError(blocked);return fresh
    }
    const value = await read(()=>requestJson('/deployments/' + deploymentId + '/context?wallet=' + encodeURIComponent(account)))
    scope?.assertActive()
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
    const [balances, allowances, native] = await read(()=>Promise.all([
      Promise.all(tokens.map(token => robinhoodClient.readContract({ address: token.address,abi,functionName:'balanceOf',args:[account] }) as Promise<bigint>)),
      Promise.all(tokens.map(token => robinhoodClient.readContract({ address: token.address,abi,functionName:'allowance',args:[account,snapshot.adapter] }) as Promise<bigint>)),
      robinhoodClient.getBalance({address:account}),
    ]))
    scope?.assertActive()
    const envelopeKey=[identity,snapshot.adapter,...tokens.map(t=>t.address)].join(':').toLowerCase()
    const previous=spendEnvelope.current?.key===envelopeKey?spendEnvelope.current.maximums:null
    const maximums = rawAmounts.map((amount,i) => {
      // Reuse the reviewed bound while it covers actual spend. On reopening,
      // an existing finite allowance can cover spend without a new 0.5% top-up.
      const bound=previous&&previous[i]>=amount?previous[i]:ceilDiv(amount*10050n,10000n)
      return allowances[i]>=amount&&allowances[i]<bound?allowances[i]:bound
    })
    spendEnvelope.current={key:envelopeKey,maximums}
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
    if(operation.current&&!operation.current.submitted)return
    refreshing.current?.cancel()
    const scope=new WalletPreflight(isVisible);refreshing.current=scope
    setError(null);setQuote(null)
    try { await load(scope) }
    catch(cause) { if(isVisible()&&refreshing.current===scope){setQuote(null);setError(cause instanceof Error?cause.message:'Deposit unavailable.')} }
    finally { if(refreshing.current===scope)refreshing.current=null }
  }
  refreshCurrent.current=()=>void refresh()
  /** Chain confirmation and server journaling are separate durable states.
   * Retry only idempotent registration, never the wallet send. Cancellation
   * stops this view's retry while the record survives navigation/reload. */
  useEffect(()=>{
    if(!pending?.chainConfirmed||!pending.hash)return
    if(pending.stage===mode){setCompleted(true);setQuote(null)}
    const abort=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined,attempt=0
    async function register(){
      try{
        const record=readIntentRecord(key,account,deploymentId)
        if(!record.value?.chainConfirmed||record.value.hash!==pending!.hash)return
        await requestJson('/deployments/'+deploymentId+'/transactions',{hash:record.value.hash,wallet:account},abort.signal)
        if(abort.signal.aborted)return
        // Another tab/action may have changed storage during the HTTP wait.
        if(localStorage.getItem(key)!==record.raw)return
        persist(null,record)
        window.dispatchEvent(new Event('saffron:vault-updated'))
        refreshCurrent.current()
      }catch{
        if(!abort.signal.aborted)timer=setTimeout(()=>void register(),Math.min(30_000,1000*2**Math.min(attempt++,5)))
      }
    }
    void register()
    return()=>{abort.abort();clearTimeout(timer)}
  },[key,pending?.hash,pending?.chainConfirmed,mode])
  useEffect(()=>{
    mounted.current=true
    setBusy(false);setCloseBlocked(false);setCompleted(false)
    void refresh()
    return()=>{
      mounted.current=false;cancelPreflight()
      if(operation.current&&!operation.current.submitted)operation.current=null
    }
  },[account,deploymentId,mode])
  foregroundState.current=()=>{
    if(busy||completed||document.hidden)return
    // A return is permission to read evidence, never to submit a wallet action.
    if(pending?.chainConfirmed)void refresh()
    else if(pending?.hash)void recover()
    else void refresh()
  }
  useEffect(()=>{
    const resume=()=>foregroundState.current()
    window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume)
    return()=>{window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}
  },[])

  async function confirm(intent: Intent, initial: IntentRecord) {
    let record=initial
    if (!intent.hash || !/^0x[0-9a-fA-F]{64}$/.test(intent.hash)) throw new Error('Enter the transaction hash from your wallet to recover.')
    let hash=intent.hash
    const receipt=await robinhoodClient.waitForTransactionReceipt({hash,confirmations:2,timeout:60_000,
      onReplaced: replacement=>{ hash=replacement.transaction.hash;record=persist({...intent,hash},record) }})
    const [tx,block]=await Promise.all([robinhoodClient.getTransaction({hash}),robinhoodClient.getBlock({blockNumber:receipt.blockNumber})])
    if (block.hash!==receipt.blockHash) throw new Error('Transaction block changed. Keep this recovery record.')
    const expected=sameAddress(tx.from,account)&&sameAddress(tx.to,intent.to)&&tx.input===intent.data&&tx.value===BigInt(intent.value)&&tx.nonce===intent.nonce
    if (!expected) {
      const cancelled=sameAddress(tx.from,account)&&sameAddress(tx.to,account)&&tx.value===0n&&tx.input==='0x'&&receipt.logs.length===0&&tx.nonce===intent.nonce
      if (cancelled) persist(null,record)
      throw new Error(cancelled?'Wallet transaction was cancelled.':'Replacement does not match the reviewed action; recovery retained.')
    }
    if (receipt.status!=='success') {persist(null,record);throw new Error('Transaction reverted. Refresh the amounts before retrying.')}
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
    const journalPending=['deposit','claim','withdraw','recover'].includes(intent.stage)
    if(journalPending)persist({...intent,hash,chainConfirmed:true},record)
    else persist(null,record)
    if(['deposit','claim','withdraw','recover','fund','campaign-withdraw'].includes(intent.stage)){
      // A claim finishing after the visible panel became Withdraw cannot clear
      // that newer quote or suppress its refresh. Durable receipt work is separate.
      if(isVisible()){setCompleted(true);setQuote(null)}
      if(['fund','campaign-withdraw'].includes(intent.stage)&&isVisible())try{
        const value=await authedJson(account,contextPath)
        if(isVisible())setContext(value)
      }catch{if(isVisible())setError('Wallet transaction confirmed. Refresh operations to update the vault status.')}
      window.dispatchEvent(new Event('saffron:vault-updated'))
      if(!isVisible())refreshCurrent.current()
    }
    else if(isVisible())await refresh()
  }
  /** Recovery and sends share the same wallet lock. Never trust the pending
   * value captured by an old render/tab; compare its action to locked storage. */
  async function recoverAction(run:Operation,hash?:Hex) {
    let record=readIntentRecord(key,account,deploymentId)
    if(!pending||!record.value||intentIdentity(pending)!==intentIdentity(record.value)){
      setPending(record.value);throw intentChanged()
    }
    await run.scope.read(()=>assertWalletAccount(account))
    run.scope.assertActive()
    if(hash)record=persist({...record.value,hash},record)
    run.submitted=true;setCloseBlocked(true)
    await confirm(record.value!,record)
  }
  async function recover(hash?:Hex){await runLocked(run=>recoverAction(run,hash))}
  async function sendAction(run: Operation) {
    const scope=run.scope
    try {
      if(adminMode&&localStorage.getItem(mode==='fund'?programWithdrawalStorageKey(account,deploymentId):fundingStorageKey(account,deploymentId)))throw new Error('Recover the previous incentive program wallet action before starting another.')
      const stored=readIntentRecord(key,account,deploymentId)
      if(pending||stored.value){await recoverAction(run);return}
      await scope.read(()=>assertWalletAccount(account));await ensureChain(robinhoodChain,scope)
      scope.assertActive()
      // A captured review is required for funding; opening/reloading a modal
      // cannot itself authorize a transaction, even if the context later loads.
      if(adminMode&&!quote)throw new Error('Refresh and review the wallet action first.')
      const fresh=await load(scope)
      if(!fresh?.action)throw new Error('This position has no available wallet action.')
      if(fresh.blocked) throw new Error(fresh.blocked)
      if(quote && (fresh.action.stage!==quote.action.stage || fresh.action.stage==='deposit'&&fresh.rawAmounts.some((value:bigint,i:number)=>value>quote.maximums[i])
        || adminMode&&(fresh.action.to.toLowerCase()!==quote.action.to.toLowerCase()||fresh.action.data!==quote.action.data||fresh.rawAmounts[0]!==quote.rawAmounts[0]||fresh.phase!==quote.phase))) {
        throw new Error('Required action or amounts changed. Review the updated modal before continuing.')
      }
      const action=fresh.action
      // Gas simulation uses only the selected wallet, never the read-only relay.
      await scope.read(()=>walletPublicClient(robinhoodChain).estimateGas({account,to:action.to,data:action.data,value:action.value}))
      await scope.read(()=>assertWalletAccount(account))
      // Bind recovery to this nonce, not an older identical wrap/approval hash.
      const nonce = await scope.read(()=>walletPublicClient(robinhoodChain).getTransactionCount({address:account,blockTag:'pending'}))
      // Simulation/wallet-network work can outlive a program pause. Refresh its
      // authoritative policy and ownership again immediately before prompting.
      if(mode==='campaign-withdraw'){
        const latest=await load(scope)
        if(!latest||latest.phase!==fresh.phase||latest.rawAmounts[0]!==fresh.rawAmounts[0])throw new Error('Withdrawal changed. Review the updated modal before continuing.')
        await scope.read(()=>assertWalletAccount(account))
      }
      // Recheck after a slow nonce/context read. Revocation is checked again
      // synchronously at the send boundary, before any durable intent exists.
      await scope.read(()=>assertWalletAccount(account))
      if(await scope.read(()=>walletPublicClient(robinhoodChain).getChainId())!==robinhoodChain.id)throw new Error('Wallet network changed. Review the action again.')
      scope.assertActive()
      const intent:Intent={actionId:crypto.randomUUID(),stage:action.stage,account,deploymentId,to:action.to,data:action.data,value:action.value.toString(),nonce}
      let record=stored
      const client=walletClient({scope,onSubmit:()=>{
        // The SDK can perform another silent chain read before sending. Keep
        // that read cancellable, and persist only when the provider is called.
        record=persist(intent,record)
        run.submitted=true;setCloseBlocked(true)
      }})
      let hash:Hex
      try {hash=await client.sendTransaction({chain:robinhoodChain,account,to:action.to,data:action.data,value:action.value,nonce})}
      catch(cause){if(rejected(cause)&&run.submitted)persist(null,record);throw cause}
      const saved={...intent,hash};record=persist(saved,record);await confirm(saved,record)
    }catch(cause){
      if(isVisible()&&operation.current===run){
        if(mode==='campaign-withdraw')setQuote(null)
        setError(cause instanceof Error?cause.message:'Wallet action failed. Check recovery before retrying.')
      }
    }
  }
  async function advance(){await runLocked(sendAction)}
  async function runLocked(action:(run:Operation)=>Promise<void>){
    if(operation.current)return
    if(!navigator.locks){setError('This browser cannot coordinate wallet actions safely. Use a browser with Web Locks support.');return}
    refreshing.current?.cancel();refreshing.current=null
    const provider=selectedWalletProviderId()
    const run={scope:new WalletPreflight(()=>isVisible()&&selectedWalletProviderId()===provider),submitted:false}
    operation.current=run;setBusy(true);setError(null)
    try{
      await navigator.locks.request('saffron.wallet-action:'+account.toLowerCase(),{ifAvailable:true},async lock=>{
        run.scope.assertActive()
        if(!lock)throw new Error('Another Saffron wallet action is in progress. Finish it before continuing.')
        await action(run)
      })
    }catch(cause){if(isVisible()&&operation.current===run)setError(cause instanceof Error?cause.message:'Wallet action unavailable.')}
    finally{
      if(operation.current===run){
        operation.current=null
        if(isVisible()){setBusy(false);setCloseBlocked(false)}
      }
    }
  }
  return {context,quote,error,busy,closeBlocked,cancelPreflight,completed,pending,refresh,advance,recover,
    amountLabel:(i:number)=>quote?formatUnits(quote.rawAmounts[i],quote.tokens[i].decimals):'—'}
}
