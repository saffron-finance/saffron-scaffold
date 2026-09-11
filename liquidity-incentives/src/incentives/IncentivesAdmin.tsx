import { useState } from 'react'
import { formatUnits,type Address } from 'viem'
import { StepTitle } from '../host/ui'
import { authedJson } from '../host/transport'
import { useDeployments } from '../host/useDeployments'
import { ProgramAdmin } from './ProgramAdmin'
import { TreasuryInventory,FundingBrief } from './TreasuryInventory'
import { AmountReviews } from './AmountReviews'
import { DeploymentPagination } from './DeploymentPagination'
import { statusLabel,type Deployment } from './model'
import { Action,Disclosure,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

export function IncentivesAdmin({account,onConnect,onBack}:{account:Address|null;onConnect:()=>void;onBack:()=>void}){
  const data=useDeployments(account,true)
  return <Stack><Row><StepTitle>Administration</StepTitle><QuietButton onClick={onBack}>Vaults</QuietButton></Row>
    {!account?<Action onClick={onConnect}>Connect operator wallet</Action>:!data.session?<Action disabled={data.busy} onClick={()=>void data.signIn()}>Sign in as operator</Action>:!data.session.operator?<ErrorText>This wallet is not an operator.</ErrorText>:<>
      <FinePrint>{data.operatorStatus?.readiness.mode==='reviewed'?'Reviewed request execution':'Automatic request execution'} · {data.rows.length} deployments on this page. Confirmed $2 ETH payments queue creation. Premium funding is managed externally.</FinePrint>
      {data.operatorStatus&&<FinePrint>Worker gas: {data.operatorStatus.gasBalanceRaw===null?'unavailable':formatUnits(BigInt(data.operatorStatus.gasBalanceRaw),18)+' ETH'} · {data.operatorStatus.pending} pending operations · {data.operatorStatus.stalled} awaiting attention for over 24 hours.</FinePrint>}
      {data.operatorStatus&&<IntakePolicy account={account} status={data.operatorStatus} onUpdate={data.refresh}/>}
      {data.operatorStatus?.metrics&&<Disclosure><summary>Operational alerts · {data.operatorStatus.alerts.length}</summary><FinePrint>Oldest undelivered request without progress: {Math.floor(data.operatorStatus.metrics.oldestWithoutProgressSeconds/60)} minutes · treasury backlog: {data.operatorStatus.metrics.fundingBacklog} · unresolved payments: {data.operatorStatus.metrics.unresolvedPayments} · stale vault observations: {data.operatorStatus.metrics.staleVaultObservations}.</FinePrint>{data.operatorStatus.alerts.map((alert,index)=><FinePrint key={index}>{alert.severity}: {statusLabel(alert.code)}</FinePrint>)}</Disclosure>}
      <Disclosure><summary>Programs and campaign budgets</summary><ProgramAdmin account={account} onConnect={onConnect}/></Disclosure>
      <TreasuryInventory account={account} onUpdate={data.refresh}/>
      <AmountReviews account={account}/>
      <PaymentAttention account={account}/>
      <QuietButton onClick={data.refresh}>Refresh operations</QuietButton>
      {data.rows.map(row=><AdminVault key={row.id} account={account} row={row} onUpdate={data.refresh}/>)}
      <DeploymentPagination data={data}/>
    </>}{data.error&&<ErrorText role='alert'>{data.error}</ErrorText>}
  </Stack>
}
function AdminVault({account,row,onUpdate}:{account:Address;row:Deployment;onUpdate:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[original,setOriginal]=useState(''),[hash,setHash]=useState('')
  const s=row.observation
  async function run(action:string){setBusy(true);setError(undefined);try{
    await authedJson(account,'/admin/deployments/'+row.id+'/'+action,{planHash:row.planHash,maximumRaw:row.plan.premium,originalHash:original,hash})
    onUpdate()
  }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return <Stack data-deployment-id={row.id} style={{border:'1px solid #1d1d1d',padding:20,borderRadius:'var(--radius-md)',background:'#0a0a0a',overflowWrap:'anywhere'}}>
    <Row><b>{row.snapshot.display.pair} · {row.id.slice(0,8)}</b><span>{statusLabel(row.state)}</span></Row>
    <FinePrint>User {row.wallet} · {row.snapshot.durationSeconds/86400} days · ${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)} LP</FinePrint>
    <FinePrint>Premium commitment: {formatUnits(BigInt(row.plan.premium),row.plan.variableDecimals)} {row.plan.variableSymbol}. Funding: {row.fundingState}.</FinePrint>
    {s?.verified&&<FinePrint>Variable funded: {formatUnits(BigInt(s.variableSupply),s.variableDecimals)} / {formatUnits(BigInt(s.variableCapacity),s.variableDecimals)} {s.variableSymbol}.</FinePrint>}
    {row.error&&<FinePrint>{row.error} Next attempt: {new Date(row.nextAttemptAt).toLocaleString()}</FinePrint>}
    {row.plan.vault&&<FundingBrief account={account} id={row.id}/>}
    <Row style={{flexWrap:'wrap'}}>
      {['failed','waiting'].includes(row.workerState)&&<QuietButton disabled={busy} onClick={()=>void run('resume')}>Resume saved operation</QuietButton>}
      {row.workerState!=='retired'&&(!row.plan.vault||(s?.verified&&!s.isStarted&&BigInt(s.claimSupply)===0n))&&<QuietButton disabled={busy} onClick={()=>void run('retire')}>Verify external recovery and retire</QuietButton>}
    </Row>
    {s?.verified&&!s.isStarted&&BigInt(s.claimSupply)>0n&&<FinePrint>The fixed-position owner must recover their LP assets before this vault can be retired.</FinePrint>}
    <Disclosure><summary>Transaction journal and recovery</summary>
      <FinePrint>Worker signer: {row.signer}. Reconcile a replacement only after checking its onchain outcome. Then resume the saved operation.</FinePrint>
      {row.transactions.map(tx=><p key={tx.hash}><a href={'https://robinhoodchain.blockscout.com/tx/'+tx.hash} target='_blank' rel='noreferrer'>{tx.step} · nonce {tx.nonce} · {tx.confirmed?'confirmed':tx.reverted?'failed':'pending'} ↗</a></p>)}
      <label>Saved transaction<select value={original} onChange={e=>setOriginal(e.target.value)} style={{width:'100%'}}><option value=''>Select transaction</option>{row.transactions.map(tx=><option key={tx.originalHash} value={tx.originalHash}>{tx.step} · {tx.nonce}</option>)}</select></label>
      <label>Confirmed replacement hash<input value={hash} onChange={e=>setHash(e.target.value)} style={{width:'100%'}}/></label>
      <QuietButton disabled={busy||!original||!/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={()=>void run('reconcile')}>Reconcile transaction</QuietButton>
    </Disclosure>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Stack>
}

/** Confirmed fees needing external resolution stay visible, with no funding or
 * automatic-refund authority exposed by this application. */
function PaymentAttention({account}:{account:Address}){
  const [rows,setRows]=useState<any[]|null>(null),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function load(after?:string){setBusy(true);try{const result=await authedJson(account,'/admin/payments'+(after?'?cursor='+after:''));setRows(previous=>after?[...previous??[],...result.payments]:result.payments);setCursor(result.nextCursor);setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>Creation payments requiring attention</summary>
    <FinePrint>Confirmed payments blocked by late mining, changed policy or admission limits are retained. Resolve externally; do not ask the user to pay again.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void load()}>Check payment exceptions</QuietButton>
    {rows?.length===0&&<FinePrint>No recorded payment exceptions.</FinePrint>}
    {rows?.map(row=><PaymentResolution key={row.hash} account={account} row={row} onUpdate={()=>void load()}/>)}
    {cursor&&<QuietButton disabled={busy} onClick={()=>void load(cursor)}>More payments</QuietButton>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
function IntakePolicy({account,status,onUpdate}:{account:Address;status:any;onUpdate:()=>void}){
  const [mode,setMode]=useState('reviewed'),[minutes,setMinutes]=useState('60'),[serviceMinutes,setServiceMinutes]=useState('240'),[limit,setLimit]=useState('10'),[watcher,setWatcher]=useState('native-eth-v1'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const readiness=status.readiness,policy=readiness?.policy
  async function save(enabled:boolean){setBusy(true);setError('');try{
    await authedJson(account,'/admin/intake',{signer:status.signer,revision:policy?.revision??0,mode:enabled?mode:policy?.mode??mode,enabled,
      expiresAt:new Date(Date.now()+Number(minutes)*60000).toISOString(),serviceMinutes:enabled?Number(serviceMinutes):policy?.service_minutes??240,maxPending:enabled?Number(limit):policy?.max_pending??10,watcherId:enabled?watcher:policy?.watcher_id??watcher});onUpdate()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>Request intake · {readiness?.canQuote?'open':'paused'}</summary>
    <FinePrint>{readiness?.mode==='reviewed'?'Reviewed one-request execution':'Automatic queue execution'}. {readiness?.reasons.map(statusLabel).join(' · ')}. Signer process: {readiness?.workerOnline?'online':'offline'}. Watcher lag: {readiness?.watcher?.lagBlocks??'unavailable'} blocks.</FinePrint>
    {policy&&<FinePrint>Intake expires {new Date(policy.expires_at).toLocaleString()}. Declared service window: {policy.service_minutes} minutes. Queue limit: {policy.max_pending}.</FinePrint>}
    {readiness?.gas&&<FinePrint>Received fees net of confirmed refunds: {formatUnits(BigInt(readiness.gas.book.feeRevenueWei),18)} ETH · canonical gas spent: {formatUnits(BigInt(readiness.gas.book.allSpentWei),18)} ETH · outstanding gas ceiling: {formatUnits(BigInt(readiness.gas.book.exposureWei),18)} ETH · remaining subsidy allowance: {formatUnits(BigInt(readiness.gas.remainingSubsidyWei),18)} ETH. Fee revenue is separate from the signer's available balance.</FinePrint>}
    <label>Execution mode<select value={mode} onChange={e=>setMode(e.target.value)}><option value='reviewed'>Reviewed one-request</option><option value='automatic'>Automatic queue</option></select></label>
    <label>Intake window (minutes, at most 1440)<input type='number' min='1' max='1440' value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
    <label>Declared service window (minutes)<input type='number' min='1' max='1440' value={serviceMinutes} onChange={e=>setServiceMinutes(e.target.value)}/></label>
    <label>Pending request limit<input type='number' min='1' max='100' value={limit} onChange={e=>setLimit(e.target.value)}/></label>
    <label>Payment watcher ID<input value={watcher} onChange={e=>setWatcher(e.target.value)}/></label>
    <Row><QuietButton disabled={busy} onClick={()=>void save(true)}>Open reviewed intake window</QuietButton><QuietButton disabled={busy||!policy?.enabled} onClick={()=>void save(false)}>Pause new requests</QuietButton></Row>
    <FinePrint>This enables quotes only when the watcher and admission checks pass. It does not start the signer.</FinePrint>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
function PaymentResolution({account,row,onUpdate}:{account:Address;row:any;onUpdate:()=>void}){
  const [reason,setReason]=useState(''),[refundHash,setRefundHash]=useState(''),[originalHash,setOriginalHash]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function resolve(action:string){setBusy(true);setError('');try{
    await authedJson(account,'/admin/payments/'+row.hash+'/'+action,{revision:row.revision,requestKey:crypto.randomUUID(),reason,refundHash,originalHash});onUpdate()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Stack style={{overflowWrap:'anywhere'}}><FinePrint>Quote {row.quote_id} · wallet {row.wallet}. Received {formatUnits(BigInt(row.amount_wei),18)} ETH · {statusLabel(row.kind)} · {statusLabel(row.state)}. <a href={'https://robinhoodchain.blockscout.com/tx/'+row.hash} target='_blank' rel='noreferrer'>Payment transaction ↗</a></FinePrint>
    <label>Resolution reason<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
    <Row>{!row.deployment_id&&!['duplicate-fee','underpayment','overpayment'].includes(row.kind)&&['received','needs_attention'].includes(row.state)&&<QuietButton disabled={busy||reason.trim().length<3} onClick={()=>void resolve('admit')}>Admit original request</QuietButton>}
    {['received','needs_attention','admitted'].includes(row.state)&&<QuietButton disabled={busy||reason.trim().length<3} onClick={()=>void resolve('refund-due')}>Freeze creation and mark refund due</QuietButton>}</Row>
    {row.state==='refund_due'&&<FinePrint>Resolve saved transactions and retire the original request before sending a refund externally. A duplicate fee does not require retiring the original request.</FinePrint>}
    {['refund_due','confirming','reconciliation_required'].includes(row.state)&&<>
      <FinePrint>Confirmed refunds: {formatUnits(BigInt(row.refunded_wei),18)} ETH. Still owed: {formatUnits(BigInt(row.amount_wei)-BigInt(row.refunded_wei),18)} ETH. Verify any pending transfer before sending another.</FinePrint>
      {row.refunds?.map((refund:any)=><a key={refund.hash} href={'https://robinhoodchain.blockscout.com/tx/'+refund.hash} target='_blank' rel='noreferrer'>{statusLabel(refund.state)} refund ↗</a>)}
      <label>External refund transaction<input value={refundHash} onChange={e=>setRefundHash(e.target.value)}/></label>
      <QuietButton disabled={busy||reason.trim().length<3||!/^0x[0-9a-f]{64}$/i.test(refundHash)} onClick={()=>void resolve('refund')}>Verify and record external refund</QuietButton>
      {row.refunds?.some((r:any)=>r.state!=='confirmed')&&<>
        <label>Saved refund to reconcile<select value={originalHash} onChange={e=>setOriginalHash(e.target.value)}><option value=''>Select pending refund</option>{row.refunds.filter((r:any)=>r.state!=='confirmed').map((r:any)=><option key={r.hash} value={r.hash}>{r.hash}</option>)}</select></label>
        <QuietButton disabled={busy||!originalHash||reason.trim().length<3||!/^0x[0-9a-f]{64}$/i.test(refundHash)} onClick={()=>void resolve('refund-replacement')}>Verify replacement or cancellation</QuietButton>
      </>}
    </>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}</Stack>
}
