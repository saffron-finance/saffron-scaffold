import { useEffect, useState } from 'react'
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, formatUnits, type Address, type Hex } from 'viem'
import { walletClient, walletPublicClient, assertWalletAccount, ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { abi, WETH, eligibility, sameAddress } from '../../shared/vault-lifecycle.mjs'
import { readVault } from '../../shared/vault-reader.mjs'
import { amountsForLiquidity, ceilDiv } from '../../shared/liquidity-math.mjs'
import { robinhoodClient, requestJson } from './transport'
import { positionAction } from '../../shared/position-actions.mjs'

type Intent = { stage: string; account: Address; deploymentId: string; to: Address; data: Hex; value: string; nonce: number; hash?: Hex }
export const positionStorageKey = (account: string, deploymentId: string) => 'saffron.position-action.v1:' + account.toLowerCase() + ':' + deploymentId
const rejected = (cause: unknown): boolean => {
  let current = cause as { code?: number; cause?: unknown } | undefined
  for (let i = 0; current && i < 8; i++, current = current.cause as typeof current) if (current.code === 4001) return true
  return false
}

/** Native fixed-only controller. Durable intent precedes a wallet prompt; lost
 * responses never silently become permission to send a second transaction.
 */
export function useVaultPosition(account: Address, deploymentId: string, mode: string) {
  const key = positionStorageKey(account, deploymentId)
  const [context, setContext] = useState<any>(null)
  const [quote, setQuote] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
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
    const value = await requestJson('/deployments/' + deploymentId + '/context')
    const snapshot = await readVault(value.job, (method, params) => robinhoodClient.request({ method, params } as any), { confirmations: 2 })
    setContext({...value,snapshot})
    if(mode==='view'){setQuote(null);return null}
    if(mode!=='deposit'){
      const action=positionAction(snapshot,mode)
      const fresh={snapshot,tokens:[snapshot.token0,snapshot.token1],rawAmounts:action.amounts??[0n,0n],maximums:action.amounts??[0n,0n],action,blocked:null}
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
    const fresh={snapshot,tokens,rawAmounts,maximums,action,blocked}
    setContext(value);setQuote(fresh);setError(blocked)
    return fresh
  }
  async function refresh() {
    setError(null)
    try { await load() } catch(cause) { setQuote(null);setError(cause instanceof Error?cause.message:'Deposit unavailable.') }
  }
  useEffect(()=>{ void refresh() },[account,deploymentId,mode])

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
    if (intent.stage === 'deposit') {
      const deposited = receipt.logs.some(log => {
        if (!sameAddress(log.address, intent.to) || log.removed) return false
        try { const event = decodeEventLog({abi, data:log.data, topics:log.topics}); return event.eventName === 'FundsDeposited' && (event.args as any).side === 0n && sameAddress((event.args as any).user, account) } catch { return false }
      })
      if (!deposited) throw new Error('Expected fixed-deposit event not found. Recovery retained.')
    }
    if(['deposit','claim','withdraw','recover'].includes(intent.stage))await requestJson('/deployments/'+deploymentId+'/transactions',{hash,wallet:account})
    persist(null)
    if(['deposit','claim','withdraw','recover'].includes(intent.stage)){setCompleted(true);setQuote(null);window.dispatchEvent(new Event('saffron:vault-updated'))}
    else await refresh()
  }
  async function recover(hash?: Hex) {
    if(!pending)return
    setBusy(true);setError(null)
    try {const intent={...pending,...(hash?{hash}:{})};persist(intent);await confirm(intent)}
    catch(cause){setError(cause instanceof Error?cause.message:'Recovery check failed. Record retained.')}
    finally{setBusy(false)}
  }
  async function sendAction() {
    const stored=localStorage.getItem(key)
    if(pending){await recover();return}
    if(stored){setPending(JSON.parse(stored));return}
    setBusy(true);setError(null)
    try {
      await assertWalletAccount(account);await ensureChain(robinhoodChain)
      const fresh=await load()
      if(!fresh?.action)throw new Error('This position has no available wallet action.')
      if(fresh.blocked) throw new Error(fresh.blocked)
      if(quote && (fresh.action.stage!==quote.action.stage || fresh.action.stage==='deposit'&&fresh.rawAmounts.some((value:bigint,i:number)=>value>quote.maximums[i]))) {
        throw new Error('Required action or amounts changed. Review the updated modal before continuing.')
      }
      const action=fresh.action
      // Gas simulation uses only the selected wallet, never the read-only relay.
      await walletPublicClient(robinhoodChain).estimateGas({account,to:action.to,data:action.data,value:action.value})
      await assertWalletAccount(account)
      // Bind recovery to this nonce, not an older identical wrap/approval hash.
      const nonce = await walletPublicClient(robinhoodChain).getTransactionCount({address:account,blockTag:'pending'})
      const intent:Intent={stage:action.stage,account,deploymentId,to:action.to,data:action.data,value:action.value.toString(),nonce}
      persist(intent)
      let hash:Hex
      try {hash=await walletClient().sendTransaction({chain:robinhoodChain,account,to:action.to,data:action.data,value:action.value,nonce})}
      catch(cause){if(rejected(cause))persist(null);throw cause}
      const saved={...intent,hash};persist(saved);await confirm(saved)
    }catch(cause){setError(cause instanceof Error?cause.message:'Wallet action failed. Check recovery before retrying.')}
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
