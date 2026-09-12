import { useRef,useState } from 'react'
import { formatUnits,type Address } from 'viem'
import { authedJson } from '../host/transport'
import { Disclosure,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

/** Operator-only preparation and verification. Payouts are performed externally. */
export function RefundAdmin({account}:{account:Address}){
  const [payments,setPayments]=useState<any[]>([]),[batches,setBatches]=useState<any[]>([]),[batch,setBatch]=useState<any>(null)
  const [cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[source,setSource]=useState(''),[reason,setReason]=useState(''),[category,setCategory]=useState('deployment_failed'),[stopped,setStopped]=useState(false),[hashes,setHashes]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const keys=useRef(new Map<string,string>())
  const key=(action:string)=>{if(!keys.current.has(action))keys.current.set(action,crypto.randomUUID());return keys.current.get(action)!}
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  async function load(after?:string){
    const page=await authedJson(account,'/admin/payments?all=true&limit=100'+(after?'&cursor='+after:''))
    setPayments(previous=>after?[...previous,...page.payments]:page.payments);setCursor(page.nextCursor)
    setBatches((await authedJson(account,'/admin/refunds')).batches)
  }
  async function open(id:string){setBatch(await authedJson(account,'/admin/refunds/'+id))}
  const eligible=payments.filter(row=>selected.includes(row.hash))
  function download(){const url=URL.createObjectURL(new Blob([batch.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='refund-'+batch.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <Disclosure><summary>External creation-fee refunds</summary><Stack>
    <FinePrint>Use only when deployment or premium funding cannot be fulfilled. Stop external funding first. Repay the original ETH fee on Robinhood; gas and bulk-sender fees are separate. Approval stops creation but does not send funds.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void run(()=>load())}>Load refundable requests and batches</QuietButton>
    {payments.filter(row=>row.deployment_id&&['admitted','needs_attention','refund_pending','refund_exception'].includes(row.state)).map(row=><label key={row.hash} style={{overflowWrap:'anywhere'}}><input type='checkbox' checked={selected.includes(row.hash)} onChange={e=>setSelected(values=>e.target.checked?[...values,row.hash]:values.filter(hash=>hash!==row.hash))}/> {row.deployment_id.slice(0,8)} · {formatUnits(BigInt(row.amount_wei),18)} ETH · {row.state} · {row.wallet}</label>)}
    {cursor&&<QuietButton disabled={busy} onClick={()=>void run(()=>load(cursor))}>More refund candidates</QuietButton>}
    <label>Unfulfillable reason<select value={category} onChange={e=>setCategory(e.target.value)}><option value='deployment_failed'>Deployment cannot be completed</option><option value='funding_unavailable'>Required premium cannot be funded</option></select></label>
    <label>Operator explanation<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
    <label><input type='checkbox' checked={stopped} onChange={e=>setStopped(e.target.checked)}/> External funder has stopped work for these requests</label>
    <QuietButton disabled={busy||!stopped||reason.trim().length<3||!eligible.some(row=>['admitted','needs_attention'].includes(row.state))} onClick={()=>void run(async()=>{
      for(const row of eligible.filter(row=>['admitted','needs_attention'].includes(row.state)))await authedJson(account,'/admin/payments/'+row.hash+'/refund',{revision:row.revision,requestKey:key('approve:'+row.hash+':'+row.revision+':'+category+':'+reason),reason,category,fundingStopped:stopped})
      await load()
    })}>Approve selected full-fee refunds and stop creation</QuietButton>
    <label>Approved refund sender address<input value={source} onChange={e=>setSource(e.target.value)} placeholder='0x…'/></label>
    <QuietButton disabled={busy||!/^0x[0-9a-fA-F]{40}$/.test(source)||!eligible.length||eligible.some(row=>!['refund_pending','refund_exception'].includes(row.state))} onClick={()=>void run(async()=>{
      const result=await authedJson(account,'/admin/refunds/prepare',{source,payments:selected,requestKey:key('prepare:'+source+':'+[...selected].sort().join(','))});setBatch(result);await load()
    })}>Prepare selected refund batch</QuietButton>
    {batches.map(row=><QuietButton key={row.id} disabled={busy} onClick={()=>void run(()=>open(row.id))}>Batch {row.id.slice(0,8)} · {row.state}</QuietButton>)}
    {batch&&<Stack><b>Batch {batch.id}</b><FinePrint>{batch.manifest.items.length} original payments · {batch.manifest.recipients.length} recipients · {formatUnits(BigInt(batch.outstandingWei),18)} ETH outstanding.</FinePrint>
      <FinePrint>CSV contains the frozen manifest, not an instruction to repeat a submitted payout. Pay externally through bulksender.app and return with its transaction hashes.</FinePrint>
      <Row><QuietButton onClick={download}>Download original batch CSV</QuietButton><QuietButton disabled={busy} onClick={()=>void run(()=>open(batch.id))}>Refresh refund verification</QuietButton></Row>
      <label>External transaction hashes, one per line<textarea value={hashes} onChange={e=>setHashes(e.target.value)} style={{width:'100%'}}/></label>
      <QuietButton disabled={busy||!hashes.trim()||batch.state==='superseded'} onClick={()=>void run(async()=>{setBatch(await authedJson(account,'/admin/refunds/'+batch.id+'/submit',{hashes:hashes.trim().split(/[\s,]+/)}));setHashes('')})}>Record hashes for verification</QuietButton>
      {batch.submissions.map((row:any)=><FinePrint key={row.hash} style={{overflowWrap:'anywhere'}}>{row.hash} · {row.state}{row.error?' · '+row.error:''}</FinePrint>)}
      {batch.items.map((row:any)=><FinePrint key={row.hash}>{row.hash.slice(0,10)} · {row.state} · {formatUnits(BigInt(row.verifiedWei),18)} ETH verified / {formatUnits(BigInt(row.originalWei),18)} ETH owed{row.closureError?' · '+row.closureError:''}</FinePrint>)}
      {batch.unmatched.length>0&&<ErrorText>{batch.unmatched.length} surplus or unmatched payouts require review.</ErrorText>}
      <QuietButton disabled={busy||batch.state==='superseded'||BigInt(batch.outstandingWei)===0n} onClick={()=>void run(async()=>{await authedJson(account,'/admin/refunds/'+batch.id+'/remainder',{});keys.current.clear();setSelected(batch.items.filter((row:any)=>BigInt(row.outstandingWei)>0n).map((row:any)=>row.hash));await load();await open(batch.id)})}>Close reconciled manifest to prepare a remaining-amount batch</QuietButton>
    </Stack>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Stack></Disclosure>
}
