import {operatorConsoleHref} from '../host/operatorConsole'
import { ConfigurationWarnings } from './ConfigurationWarnings'
import { RefundAdmin } from './RefundAdmin'
import { DeployerBalance } from './DeployerBalance'
import { useState,type ReactNode } from 'react'
import { useAdminHealth } from '../host/useAdminHealth'
import { IntakeSummary,OperationMetrics } from './OperatorOverview'
import { OpsButtons,OpsCard,OpsNote,OpsRow,OpsTabs } from './operator-styles'
import { formatUnits,type Address } from 'viem'
import { StepTitle } from '../host/ui'
import { authedJson } from '../host/transport'
import { useDeployments } from '../host/useDeployments'
import { ProgramAdmin } from './ProgramAdmin'
import { DeploymentPagination } from './DeploymentPagination'
import { CampaignFundingModal } from './CampaignFundingModal'
import { CampaignWithdrawalModal } from './CampaignWithdrawalModal'
import { fundingStorageKey,campaignWithdrawalStorageKey } from '../host/campaignFunding'
import styled from 'styled-components'
import { statusLabel,type Deployment } from './model'
import { Action,Disclosure,ErrorText,FinePrint,PrimaryAction,QuietButton,Row,Stack } from './styles'

/** Administration owns operations; Status owns diagnosis. All totals come from
 * live operator responses, and filters explicitly apply to the current page. */
export function IncentivesAdmin({account,onConnect,onBack,onNavigate,checkoutRecovery}:{account:Address|null;onConnect:()=>void;onBack:()=>void;onNavigate:(path:string)=>void;checkoutRecovery?:ReactNode}){
  const data=useDeployments(account,true),health=useAdminHealth(account)
  const report=health.unavailable?null:health.report
  const [tab,setTab]=useState('Overview'),[filter,setFilter]=useState('All requests')
  const [fundingRow,setFundingRow]=useState<Deployment|null>(null)
  const [withdrawalRow,setWithdrawalRow]=useState<Deployment|null>(null)
  const rows=data.rows.filter(row=>filter==='All requests'||filter==='Needs attention'&&['needs_attention','failed','waiting'].includes(row.state)||filter==='Awaiting premium'&&row.workerState==='created'&&['partial','awaiting_external'].includes(row.fundingState))
  function editIntake(){setTab('Overview');setTimeout(()=>{const node=document.getElementById('intake-controls') as HTMLDetailsElement|null;if(node){node.open=true;node.scrollIntoView({block:'center',behavior:'smooth'})}},0)}
  return <Stack>
    <OpsRow><StepTitle>Administration</StepTitle><OpsButtons><a href={operatorConsoleHref} target="_blank" rel="noopener" style={{color:"#d286ff",padding:"10px"}}>Server operator ↗</a><QuietButton onClick={()=>onNavigate('/campaigns')}>New campaign</QuietButton><QuietButton onClick={()=>onNavigate('/status')}>Status</QuietButton><QuietButton onClick={onBack}>Home</QuietButton></OpsButtons></OpsRow>
    <OpsNote>Manage real requests, review exceptions, and give each vault a clear next step.</OpsNote>
    <ConfigurationWarnings account={account} compact/>
    {!account?<Action onClick={onConnect}>Connect operator wallet</Action>:!health.session?<Action disabled={health.busy} onClick={()=>void health.signIn()}>Sign in as operator</Action>:!health.session.operator?<ErrorText>This wallet is not an operator.</ErrorText>:<>
      <DeployerBalance report={report} onRefresh={health.refresh}/>
      <OpsTabs aria-label='Administration sections'>{['Overview','Requests','Campaigns','Payments','Refunds'].map(name=><button key={name} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</OpsTabs>
      {health.unavailable&&<ErrorText role='alert'>Operational status is unavailable. Counts and readiness are not assumed. Open Status for independent checks.</ErrorText>}
      {(tab==='Overview'||tab==='Requests')&&<>
        <IntakeSummary report={report} onStatus={()=>onNavigate('/status')} onEdit={editIntake}/>
        <OperationMetrics report={report}/>
        {tab==='Overview'&&report?.readiness&&report.signer&&<IntakePolicy account={account} status={report} onUpdate={()=>{data.refresh();health.refresh();window.dispatchEvent(new Event('saffron:intake-updated'))}}/>}
        {tab==='Overview'&&report?.checks.some(c=>['blocked','unknown','warning'].includes(c.state))&&<OpsCard><h2>Needs attention</h2>{report.checks.filter(c=>['blocked','unknown','warning'].includes(c.state)).map(c=><p key={c.id}><b>{c.title}</b> — {c.detail}<br/><b>{c.owner}:</b> {c.action}</p>)}<QuietButton onClick={()=>onNavigate('/status')}>View all Status checks</QuietButton></OpsCard>}
        <OpsCard aria-label='Deployment queue'><OpsRow><h2>Deployment queue</h2><QuietButton onClick={()=>{data.refresh();health.refresh()}}>Refresh operations</QuietButton></OpsRow><OpsNote>Saved requests and their current chain-verified progress. Filters apply to this page.</OpsNote>
          <OpsTabs aria-label='Request filters'>{['All requests','Needs attention','Awaiting premium'].map(name=><button key={name} aria-pressed={filter===name} onClick={()=>setFilter(name)}>{name}</button>)}</OpsTabs>
          {data.loading&&<OpsNote>Loading requests…</OpsNote>}
          {!data.loading&&!data.error&&!rows.length&&<OpsNote>{filter==='All requests'?'No deployment requests on this page.':'No requests match this filter on this page.'}</OpsNote>}
          {rows.map(row=><Disclosure key={row.id}><summary>{row.snapshot.display.pair} · {row.id.slice(0,8)} · <AdminState state={row.state}/></summary><AdminVault account={account} row={row} onFund={()=>setFundingRow(row)} onWithdraw={()=>setWithdrawalRow(row)} onUpdate={()=>{data.refresh();health.refresh()}}/></Disclosure>)}
          <DeploymentPagination data={data}/>
        </OpsCard>
      </>}
      {tab==='Campaigns'&&<ProgramAdmin account={account} onConnect={onConnect}/>}
      {tab==='Payments'&&<>{checkoutRecovery}<PaymentAttention account={account}/></>}
      {tab==='Refunds'&&<RefundAdmin account={account}/>}
      {fundingRow&&<CampaignFundingModal key={account+fundingRow.id} account={account} row={fundingRow} onClose={()=>{setFundingRow(null);data.refresh();health.refresh()}}/>}
      {withdrawalRow&&<CampaignWithdrawalModal key={account+withdrawalRow.id} account={account} row={withdrawalRow} onClose={()=>{setWithdrawalRow(null);data.refresh();health.refresh()}}/>}
    </>}
    {health.signError&&<ErrorText role='alert'>{health.signError}</ErrorText>}{data.error&&<ErrorText role='alert'>{data.error}</ErrorText>}
  </Stack>
}

/** Administration-only wording: user-facing deposit/portfolio labels retain
 * their established language. Gold identifies a vault ready for the user. */
const UserDepositable=styled.span`color:${({theme})=>theme.colors.accent.gold};`
function AdminState({state}:{state:string}){return state==='depositable'?<UserDepositable data-admin-state='depositable'>User-depositable</UserDepositable>:<span>{statusLabel(state)}</span>}

function AdminVault({account,row,onUpdate,onFund,onWithdraw}:{account:Address;row:Deployment;onUpdate:()=>void;onFund:()=>void;onWithdraw:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[original,setOriginal]=useState(''),[hash,setHash]=useState('')
  const s=row.observation
  // Keep recovery available even if another funder filled the vault meanwhile.
  let pendingFunding=false,pendingWithdrawal=false
  try{pendingFunding=Boolean(localStorage.getItem(fundingStorageKey(account,row.id)));pendingWithdrawal=Boolean(localStorage.getItem(campaignWithdrawalStorageKey(account,row.id)))}catch{/* Storage errors are surfaced before any wallet send. */}
  const canFund=row.workerState==='created'&&!row.cancelRequested&&!row.refund&&['partial','awaiting_external'].includes(row.fundingState)
  const programStopped=['paused','closed'].includes(row.programControl?.state??'')
  async function run(action:string){setBusy(true);setError(undefined);try{
    await authedJson(account,'/admin/deployments/'+row.id+'/'+action,{planHash:row.planHash,maximumRaw:row.plan.premium,originalHash:original,hash})
    onUpdate()
  }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return <Stack data-deployment-id={row.id} style={{border:'1px solid #1d1d1d',padding:20,borderRadius:'var(--radius-md)',background:'#0a0a0a',overflowWrap:'anywhere'}}>
    <Row><b>{row.snapshot.display.pair} · {row.id.slice(0,8)}</b>{canFund||pendingFunding?<PrimaryAction disabled={pendingWithdrawal} style={{width:'auto',maxWidth:'100%',whiteSpace:'normal'}} onClick={onFund}>{pendingFunding?'Recover funding transaction':'Awaiting campaign funding'}</PrimaryAction>:<AdminState state={row.state}/>}</Row>
    <FinePrint as='ul' data-vault-details style={{paddingLeft:18,margin:0}}>
      <li>User: {row.wallet} · {row.snapshot.durationSeconds/86400} days · ${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)} LP</li>
      <li>Premium commitment: {formatUnits(BigInt(row.plan.premium),row.plan.variableDecimals)} {row.plan.variableSymbol}. Funding: {row.fundingState}.</li>
      <li>Variable funded: {s?.verified?<>{formatUnits(BigInt(s.variableSupply),s.variableDecimals)} / {formatUnits(BigInt(s.variableCapacity),s.variableDecimals)} {s.variableSymbol}.</>:'Checking current funding…'}</li>
      <li>Vault: {row.plan.vault?<a style={{color:'#d286ff'}} href={'https://robinhoodchain.blockscout.com/address/'+row.plan.vault} target='_blank' rel='noreferrer'>{row.plan.vault}</a>:'Not deployed yet'}</li>
    </FinePrint>
    {row.error&&<FinePrint>{row.error} Next attempt: {new Date(row.nextAttemptAt).toLocaleString()}</FinePrint>}
    {row.plan.vault&&<div>
      <QuietButton disabled={!pendingWithdrawal&&(!programStopped||pendingFunding)} onClick={onWithdraw}>{pendingWithdrawal?'Recover withdrawal transaction':'Withdraw from vault'}</QuietButton>
      {!pendingWithdrawal&&<FinePrint>{!programStopped?(row.programControl?.state==='active'?'Pause or close this program in Campaigns before withdrawing.':'Program status is unavailable. Refresh operations.'):'Program '+row.programControl?.state+'. Withdraw only assets owned by your connected wallet; started vaults must mature first.'}</FinePrint>}
    </div>}
    {['failed','waiting'].includes(row.workerState)&&<Row><QuietButton disabled={busy} onClick={()=>void run('resume')}>Resume saved operation</QuietButton></Row>}
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
    <FinePrint>Confirmed payments blocked by late mining, changed policy are retained. Resolve externally; do not ask the user to pay again.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void load()}>Check payment exceptions</QuietButton>
    {rows?.length===0&&<FinePrint>No recorded payment exceptions.</FinePrint>}
    {rows?.map(row=><PaymentResolution key={row.hash} account={account} row={row} onUpdate={()=>void load()}/>)}
    {cursor&&<QuietButton disabled={busy} onClick={()=>void load(cursor)}>More payments</QuietButton>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
function IntakePolicy({account,status,onUpdate}:{account:Address;status:any;onUpdate:()=>void}){
  const [mode,setMode]=useState(()=>status.readiness?.policy?.mode??'automatic'),[minutes,setMinutes]=useState('60'),[serviceMinutes,setServiceMinutes]=useState('240'),[watcher,setWatcher]=useState('native-eth-v1'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const readiness=status.readiness,policy=readiness?.policy
  async function save(enabled:boolean){setBusy(true);setError('');try{
    await authedJson(account,'/admin/intake',{signer:status.signer,revision:policy?.revision??0,mode:enabled?mode:policy?.mode??mode,enabled,
      expiresAt:new Date(Date.now()+Number(minutes)*60000).toISOString(),serviceMinutes:enabled?Number(serviceMinutes):policy?.service_minutes??240,watcherId:enabled?watcher:policy?.watcher_id??watcher});onUpdate()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure id='intake-controls'><summary>Edit intake window</summary>
    <FinePrint>{readiness?.mode==='reviewed'?'Reviewed one-request execution':'Automatic queue execution'}. {readiness?.reasons.map(statusLabel).join(' · ')}. Signer process: {readiness?.workerOnline?'online':'offline'}. Watcher lag: {readiness?.watcher?.lagBlocks??'unavailable'} blocks.</FinePrint>
    {policy&&<FinePrint>Intake expires {new Date(policy.expires_at).toLocaleString()}. Declared service window: {policy.service_minutes} minutes.</FinePrint>}
    <label>Execution mode<select value={mode} onChange={e=>setMode(e.target.value)}><option value='automatic'>Automatic queue</option><option value='reviewed'>Reviewed one-request</option></select></label>
    <label>Intake window (minutes, at most 1440)<input type='number' min='1' max='1440' value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
    <label>Declared service window (minutes)<input type='number' min='1' max='1440' value={serviceMinutes} onChange={e=>setServiceMinutes(e.target.value)}/></label>
    <label>Payment watcher ID<input value={watcher} onChange={e=>setWatcher(e.target.value)}/></label>
    <Row><QuietButton disabled={busy} onClick={()=>void save(true)}>Open intake window</QuietButton><QuietButton disabled={busy||!policy?.enabled} onClick={()=>void save(false)}>Pause new requests</QuietButton></Row>
    <FinePrint>This enables quotes only when the watcher and admission checks pass. It does not start the signer.</FinePrint>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
/** Unadmitted payments retain their separate exception policy. Accepted-request
 * refunds are prepared and verified by RefundAdmin; payouts remain external. */
function PaymentResolution({account,row,onUpdate}:{account:Address;row:any;onUpdate:()=>void}){
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function admit(){setBusy(true);setError('');try{
    await authedJson(account,'/admin/payments/'+row.hash+'/admit',{revision:row.revision,requestKey:crypto.randomUUID(),reason});onUpdate()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Stack style={{overflowWrap:'anywhere'}}><FinePrint>Quote {row.quote_id} · wallet {row.wallet}. Received {formatUnits(BigInt(row.amount_wei),18)} ETH · {statusLabel(row.kind)} · {statusLabel(row.state)}. <a href={'https://robinhoodchain.blockscout.com/tx/'+row.hash} target='_blank' rel='noreferrer'>Payment transaction ↗</a></FinePrint>
    {!row.deployment_id&&!['duplicate-fee','underpayment','overpayment'].includes(row.kind)&&['received','needs_attention'].includes(row.state)&&<>
      <label>Resolution reason<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
      <QuietButton disabled={busy||reason.trim().length<3} onClick={()=>void admit()}>Admit original request</QuietButton>
    </>}{error&&<ErrorText role='alert'>{error}</ErrorText>}</Stack>
}
