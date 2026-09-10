import { useState } from 'react'
import { formatUnits,type Address } from 'viem'
import { StepTitle } from '../host/ui'
import { authedJson } from '../host/transport'
import { useDeployments } from '../host/useDeployments'
import { ProgramAdmin } from './ProgramAdmin'
import { statusLabel,type Deployment } from './model'
import { Action,Disclosure,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

export function IncentivesAdmin({account,onConnect,onBack}:{account:Address|null;onConnect:()=>void;onBack:()=>void}){
  const data=useDeployments(account,true)
  return <Stack><Row><StepTitle>Administration</StepTitle><QuietButton onClick={onBack}>Programs</QuietButton></Row>
    {!account?<Action onClick={onConnect}>Connect operator wallet</Action>:!data.session?<Action disabled={data.busy} onClick={()=>void data.signIn()}>Sign in as operator</Action>:!data.session.operator?<ErrorText>This wallet is not an operator.</ErrorText>:<>
      <FinePrint>Worker {data.online?'online':'offline'} · {data.rows.length} deployments. User authorization queues creation automatically.</FinePrint>
      {data.operatorStatus&&<FinePrint>Worker gas: {data.operatorStatus.gasBalanceRaw===null?'unavailable':formatUnits(BigInt(data.operatorStatus.gasBalanceRaw),18)+' ETH'} · {data.operatorStatus.pending} pending operations · {data.operatorStatus.stalled} awaiting attention for over 24 hours.</FinePrint>}
      <Disclosure><summary>Programs and campaign budgets</summary><ProgramAdmin account={account} onConnect={onConnect}/></Disclosure>
      <QuietButton onClick={data.refresh}>Refresh operations</QuietButton>
      {data.rows.map(row=><AdminVault key={row.id} account={account} row={row} onUpdate={data.refresh}/>)}
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
  return <Stack style={{border:'1px solid #1d1d1d',padding:20,borderRadius:12,overflowWrap:'anywhere'}}>
    <Row><b>{row.snapshot.display.pair} · {row.id.slice(0,8)}</b><span>{statusLabel(row.state)}</span></Row>
    <FinePrint>User {row.wallet} · {row.snapshot.durationSeconds/86400} days · ${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)} LP</FinePrint>
    <FinePrint>Premium commitment: {formatUnits(BigInt(row.plan.premium),row.plan.variableDecimals)} {row.plan.variableSymbol}. Funding: {row.fundingState}.</FinePrint>
    {s?.verified&&<FinePrint>Variable funded: {formatUnits(BigInt(s.variableSupply),s.variableDecimals)} / {formatUnits(BigInt(s.variableCapacity),s.variableDecimals)} {s.variableSymbol}.</FinePrint>}
    {row.error&&<FinePrint>{row.error} Next attempt: {new Date(row.nextAttemptAt).toLocaleString()}</FinePrint>}
    <Row style={{flexWrap:'wrap'}}>
      {row.workerState==='created'&&s?.verified&&!s.isStarted&&!row.cancelRequested&&BigInt(s.variableSupply)<BigInt(s.variableCapacity)&&<QuietButton disabled={busy||['queued','running','waiting'].includes(row.fundingState)} onClick={()=>void run('fund')}>Approve premium funding</QuietButton>}
      {(row.workerState==='failed'||['failed','waiting'].includes(row.fundingState)||row.error)&&row.workerState!=='retired'&&<QuietButton disabled={busy} onClick={()=>void run('resume')}>Resume saved operation</QuietButton>}
      {row.workerState!=='retired'&&!s?.isStarted&&<QuietButton disabled={busy} onClick={()=>void run('retire')}>Recover unused funding and retire</QuietButton>}
      {s?.isStarted&&Number(s.blockTimestamp)>Number(s.endTime)&&BigInt(s.fundingBearerBalance)>0n&&<QuietButton disabled={busy} onClick={()=>void run('collect')}>Collect variable-side fees</QuietButton>}
    </Row>
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
