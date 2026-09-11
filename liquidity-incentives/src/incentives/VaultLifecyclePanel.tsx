import { useEffect,useState } from 'react'
import { formatUnits,type Address,type Hex } from 'viem'
import { useVaultPosition } from '../host/useVaultPosition'
import { authedJson,ensureSession } from '../host/transport'
import type { Deployment } from './model'
import { statusLabel } from './model'
import { Action,ErrorText,FinePrint,QuietButton,Row,Stack,Disclosure } from './styles'
import { VaultReview } from './VaultReview'

/** Fixed-position actions share the request view's single status poll. */
export function VaultLifecyclePanel({account,id,onBusy,row,verificationError}:{account:Address;id:string;onBusy:(busy:boolean)=>void;row:Deployment|null;verificationError?:string}){
  const [error,setError]=useState<string>(),[hash,setHash]=useState(''),[cancelling,setCancelling]=useState(false)
  const mode=verificationError?'view':row?.canClaim?'claim':row?.canWithdraw?'withdraw':row?.canRecover?'recover':row?.depositable?'deposit':'view'
  const flow=useVaultPosition(account,id,mode)
  useEffect(()=>{onBusy(flow.busy||cancelling)},[flow.busy,cancelling])
  const s=flow.quote?.snapshot??row?.observation
  async function cancel(){setCancelling(true);try{await authedJson(account,'/deployments/'+id+'/cancel',{});window.dispatchEvent(new Event('saffron:vault-updated'))}catch(cause){setError((cause as Error).message)}finally{setCancelling(false)}}
  return <Stack data-vault-lifecycle={id}>
    <b role='status'>{row?statusLabel(row.state):'Loading your vault…'}</b>
    {row&&<VaultReview label='Vault terms' bullets={<>
      <li>LP value at request: <b>${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)}</b> · full range.</li>
      <li>Lock after start: <b>{row.snapshot.durationSeconds/86400} days</b>.</li>
      <li>Committed premium: <b>{formatUnits(BigInt(row.plan.premium),row.plan.variableDecimals)} {row.plan.variableSymbol}</b>.</li>
    </>} details={<><p>Vault {row.plan.vault??'Creation pending'}</p><p>Deployment {row.id}</p><p>Network: Robinhood Chain. Wallet transactions require network gas. Creation gas is paid by the service.</p></>}/>}
    {row?.state==='awaiting_funding'&&<FinePrint>Your vault is created. Deposit becomes available after the campaign operator funds the entire premium externally.</FinePrint>}
    {row?.canClaim&&<FinePrint>Claiming transfers your premium and converts your claim token into the fixed bearer token used for withdrawal.</FinePrint>}
    {row?.state==='active'&&s&&<FinePrint>Premium claimed. Your LP assets unlock after {new Date(Number(s.endTime)*1000).toLocaleString()}.</FinePrint>}
    {row?.state==='matured'&&row.canClaim&&<FinePrint>Your position has matured. Claim the premium first, then withdraw the LP assets.</FinePrint>}
    {row?.canRecover&&<FinePrint>Your fixed deposit was confirmed, but the vault has not started. You can recover the LP assets while it remains unstarted.</FinePrint>}
    {row?.canRecover&&row.cancelRequested&&<FinePrint>Recover your LP assets before the operator can finish retiring this vault.</FinePrint>}
    {flow.quote&&mode!=='claim'&&<>
      <Row><span>{mode==='deposit'?'LP assets required':'Estimated LP assets returned'}</span></Row>
      {[0,1].map(i=><FinePrint key={i}>{flow.amountLabel(i)} {flow.quote.tokens[i].symbol}</FinePrint>)}
      <FinePrint>Slippage: 0.5% · deadline: 5 minutes. The token mix can change with pool price; LP positions are subject to impermanent loss.</FinePrint>
    </>}
    {(verificationError||error||flow.error)&&<ErrorText role='alert'>{verificationError??error??flow.error}</ErrorText>}
    {/Sign in|wallet session/.test(error??flow.error??'')&&<Action disabled={flow.busy||cancelling} onClick={async()=>{setCancelling(true);try{await ensureSession(account);setError(undefined);window.dispatchEvent(new Event('saffron:vault-updated'));await flow.refresh()}catch(cause){setError((cause as Error).message)}finally{setCancelling(false)}}}>Restore payment session</Action>}
    {flow.pending?<Stack>
      <FinePrint>A wallet action needs confirmation. Check it before submitting another.</FinePrint>
      {flow.pending.hash&&<a href={'https://robinhoodchain.blockscout.com/tx/'+flow.pending.hash} target='_blank' rel='noreferrer'>View submitted transaction ↗</a>}
      <label>Transaction hash (for a missing response or replacement)<input aria-label='Recover transaction hash' value={hash} onChange={e=>setHash(e.target.value)} style={{width:'100%'}}/></label>
      <Action disabled={flow.busy||(!flow.pending.hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))} onClick={()=>void flow.recover(hash?hash as Hex:undefined)}>{flow.busy?'Checking transaction…':'Check transaction'}</Action>
    </Stack>:mode!=='view'?<>
      <QuietButton disabled={flow.busy} onClick={()=>void flow.refresh()}>Refresh position</QuietButton>
      <Action disabled={flow.busy||!flow.quote||Boolean(flow.quote.blocked)} onClick={()=>void flow.advance()}>{flow.busy?'Confirming wallet action…':flow.quote?.action.label??'Checking position…'}</Action>
    </>:null}
    {row?.state==='completed'&&<FinePrint>Your fixed withdrawal is confirmed and your LP assets have been returned.</FinePrint>}
    {row?.isRequester&&!row.cancelRequested&&['queued','deploying','awaiting_funding','depositable','needs_attention'].includes(row.state)&&<Disclosure><summary>Deployment options</summary><FinePrint>Retirement releases unused capacity only after pending transactions and any funded premium have been reconciled.</FinePrint><QuietButton disabled={flow.busy||cancelling} onClick={()=>void cancel()}>Request retirement</QuietButton></Disclosure>}
    {row?.transactions.length?<Disclosure><summary>Deployment transactions</summary>{row.transactions.map(tx=><p key={tx.hash}><a target='_blank' rel='noreferrer' href={'https://robinhoodchain.blockscout.com/tx/'+tx.hash}>{tx.step.replaceAll('-',' ')} · {tx.confirmed?'confirmed':tx.reverted?'failed':'pending'} ↗</a></p>)}</Disclosure>:null}
  </Stack>
}
