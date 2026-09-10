import type { Address } from 'viem'
import { StepTitle } from '../host/ui'
import type { useDeployments } from '../host/useDeployments'
import { statusLabel } from './model'
import { Action,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

export function MyVaults({account,positions,onConnect,onOpen,onBack,onAdmin}:{account:Address|null;positions:ReturnType<typeof useDeployments>;onConnect:()=>void;onOpen:(id:string)=>void;onBack:()=>void;onAdmin:()=>void}){
  return <Stack><Row><StepTitle>My vaults</StepTitle><QuietButton onClick={onBack}>Programs</QuietButton></Row>
    {!account?<Action onClick={onConnect}>Connect wallet</Action>:!positions.session?<Action disabled={positions.busy} onClick={()=>void positions.signIn()}>{positions.busy?'Confirm wallet signature…':'Sign in to view your vaults'}</Action>:<>
      {!positions.online&&<FinePrint>The deployment worker is offline. Accepted deployments remain saved.</FinePrint>}
      {positions.positionsUpdating&&<FinePrint>Checking for received positions. More vaults may appear as confirmations become available.</FinePrint>}
      {positions.loading?<FinePrint>Loading vaults…</FinePrint>:!positions.rows.length&&!positions.positionsUpdating?<FinePrint>You have no deployments or received positions yet. Choose an incentive program to create your first vault.</FinePrint>:null}
      {positions.rows.map(row=><Stack key={row.id} style={{padding:20,border:'1px solid #1d1d1d',borderRadius:12,background:'#0a0a0a'}}>
        <Row><b>{row.snapshot.display.pair} · {row.snapshot.durationSeconds/86400} days</b><span role='status'>{statusLabel(row.state)}</span></Row>
        <FinePrint>${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)} LP at authorization · {row.id.slice(0,8)}</FinePrint>
        <QuietButton onClick={()=>onOpen(row.id)}>{row.depositable?'Deposit':row.canClaim?'Claim premium':row.canWithdraw?'Withdraw':row.canRecover?'Recover LP assets':'View vault'}</QuietButton>
      </Stack>)}
      <Row><QuietButton onClick={positions.refresh}>Refresh vaults</QuietButton>{positions.session.operator&&<QuietButton onClick={onAdmin}>Administration</QuietButton>}</Row>
    </>}
    {positions.error&&<ErrorText role='alert'>{positions.error}</ErrorText>}
  </Stack>
}
