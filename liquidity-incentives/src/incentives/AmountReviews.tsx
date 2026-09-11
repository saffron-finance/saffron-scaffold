import { useState } from 'react'
import type { Address } from 'viem'
import { authedJson } from '../host/transport'
import { Disclosure,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'
export function AmountReviews({account}:{account:Address}){
  const [rows,setRows]=useState<any[]>(),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function load(after?:string){setBusy(true);setError('');try{const data=await authedJson(account,'/admin/amount-reviews'+(after?'?cursor='+after:''));setRows(previous=>after?[...previous??[],...data.reviews]:data.reviews);setCursor(data.nextCursor)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>Unpaid amount reviews</summary><FinePrint>Approval allows one exact checkout above the public size/share limits for 15 minutes. All campaign, treasury, queue and gas limits still apply before payment. This does not create a vault or reserve inventory.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void load()}>Load amount reviews</QuietButton>
    {rows?.length===0&&<FinePrint>No pending amount reviews.</FinePrint>}{rows?.map(row=><Review key={row.id} account={account} row={row} refresh={()=>void load()}/>)}
    {cursor&&<QuietButton disabled={busy} onClick={()=>void load(cursor)}>More amount reviews</QuietButton>}{error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
function Review({account,row,refresh}:{account:Address;row:any;refresh:()=>void}){
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function decide(action:string){setBusy(true);setError('');try{await authedJson(account,'/admin/amount-reviews/'+row.id,{action,reason,revision:row.revision,requestKey:crypto.randomUUID()});refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Stack><FinePrint style={{overflowWrap:'anywhere'}}>{row.wallet} · {row.program_id} · ${(Number(row.principal_cents)/100).toFixed(2)} · {row.state} · expires {new Date(row.expires_at).toLocaleString()}</FinePrint>
    {row.state==='pending'&&<><label>Amount review reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label><Row><QuietButton disabled={busy||reason.trim().length<8} onClick={()=>void decide('approve')}>Approve amount</QuietButton><QuietButton disabled={busy||reason.trim().length<8} onClick={()=>void decide('decline')}>Decline amount</QuietButton></Row></>}{error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Stack>
}
