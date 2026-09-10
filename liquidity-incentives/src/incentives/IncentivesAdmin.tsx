import { useState } from 'react'
import { formatUnits,type Address } from 'viem'
import { StepTitle } from '../host/ui'
import { authedJson } from '../host/transport'
import { useDeployments } from '../host/useDeployments'
import { ProgramAdmin } from './ProgramAdmin'
import { DeploymentPagination } from './DeploymentPagination'
import { statusLabel,type Deployment } from './model'
import { Action,Disclosure,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

export function IncentivesAdmin({account,onConnect,onBack}:{account:Address|null;onConnect:()=>void;onBack:()=>void}){
  const data=useDeployments(account,true)
  return <Stack><Row><StepTitle>Administration</StepTitle><QuietButton onClick={onBack}>Vaults</QuietButton></Row>
    {!account?<Action onClick={onConnect}>Connect operator wallet</Action>:!data.session?<Action disabled={data.busy} onClick={()=>void data.signIn()}>Sign in as operator</Action>:!data.session.operator?<ErrorText>This wallet is not an operator.</ErrorText>:<>
      <FinePrint>Worker {data.online?'online':'offline'} · {data.rows.length} deployments on this page. Confirmed $2 ETH payments queue creation automatically. Premium funding is managed externally.</FinePrint>
      {data.operatorStatus&&<FinePrint>Worker gas: {data.operatorStatus.gasBalanceRaw===null?'unavailable':formatUnits(BigInt(data.operatorStatus.gasBalanceRaw),18)+' ETH'} · {data.operatorStatus.pending} pending operations · {data.operatorStatus.stalled} awaiting attention for over 24 hours.</FinePrint>}
      <Disclosure><summary>Programs and campaign budgets</summary><ProgramAdmin account={account} onConnect={onConnect}/></Disclosure>
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
    {row.plan.vault&&<FinePrint>Fund externally using variable-side deposit into {row.plan.vault}. Token: {row.snapshot.variableAssetAddress}. Required total: {row.plan.premium} raw units. Plain token transfers do not count.</FinePrint>}
    <Row style={{flexWrap:'wrap'}}>
      {(row.workerState==='failed'||['failed','waiting'].includes(row.fundingState)||row.error)&&row.workerState!=='retired'&&<QuietButton disabled={busy} onClick={()=>void run('resume')}>Resume saved operation</QuietButton>}
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
  const [rows,setRows]=useState<any[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function load(){setBusy(true);try{setRows((await authedJson(account,'/admin/payments')).payments);setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>Creation payments requiring attention</summary>
    <FinePrint>Confirmed payments blocked by late mining, changed policy or admission limits are retained. Resolve externally; do not ask the user to pay again.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void load()}>Check payment exceptions</QuietButton>
    {rows?.length===0&&<FinePrint>No recorded payment exceptions.</FinePrint>}
    {rows?.map(row=><FinePrint key={row.hash} style={{overflowWrap:'anywhere'}}>Quote {row.quote_id} · wallet {row.wallet}. {row.error} <a href={'https://robinhoodchain.blockscout.com/tx/'+row.hash} target='_blank' rel='noreferrer'>Payment transaction ↗</a></FinePrint>)}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
