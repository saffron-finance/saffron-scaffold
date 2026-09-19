import {useRef,useState} from 'react'
import {formatUnits,type Address} from 'viem'
import styled from 'styled-components'
import {authedJson} from '../host/transport'
import {ErrorText,FinePrint,Row,Stack} from './styles'
import {programText} from './program-language'
import {AdminAction,AdminOutline,AdminPanel,AdminGold,AdminKicker,AdminBadge,AdminField,AdminCheck} from './admin-workspace-styles'

const reviewStates=['admitted','needs_attention'],prepareStates=['refund_pending','refund_exception']
/** Formatting never rounds original wei. Unknown evidence is not a zero fee. */
const eth=(value:unknown)=>typeof value==='string'&&/^\d+$/.test(value)?formatUnits(BigInt(value),18):'Unavailable'
/** Keep the approval subtotal separate from already-approved selections. */
const originalFees=(rows:any[])=>rows.every(row=>/^\d+$/.test(String(row.amount_wei)))?rows.reduce((sum,row)=>sum+BigInt(row.amount_wei),0n).toString():null
const paymentLabel=(state:string)=>({admitted:'Needs review',needs_attention:'Needs review',refund_pending:'Approved',refund_exception:'Needs reconciliation'}[state]??programText(state.replaceAll('_',' ')))

/** R1 guided review is operator-only preparation and verification. All writes
 * retain the original revision/idempotency contracts; payouts remain external. */
export function RefundAdmin({account}:{account:Address}){
  const [payments,setPayments]=useState<any[]>([]),[batches,setBatches]=useState<any[]>([]),[batch,setBatch]=useState<any>(null)
  const [cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[source,setSource]=useState(''),[reason,setReason]=useState(''),[category,setCategory]=useState('deployment_failed'),[stopped,setStopped]=useState(false),[hashes,setHashes]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[readFailed,setReadFailed]=useState(false)
  const reviewRef=useRef<HTMLElement>(null),prepareRef=useRef<HTMLElement>(null),verifyRef=useRef<HTMLElement>(null)
  const keys=useRef(new Map<string,string>())
  const key=(action:string)=>{if(!keys.current.has(action))keys.current.set(action,crypto.randomUUID());return keys.current.get(action)!}
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work()}catch(cause){setError(programText((cause as Error).message))}finally{setBusy(false)}}
  /** Publish a consistent snapshot only after both reads succeed. Keep prior
   * evidence visible after a failure, but disable decisions until refreshed. */
  async function load(after?:string){
    try{
      const page=await authedJson(account,'/admin/payments?all=true&limit=100'+(after?'&cursor='+after:''))
      const result=await authedJson(account,'/admin/refunds')
      setPayments(previous=>after?[...previous,...page.payments]:page.payments);setCursor(page.nextCursor);setBatches(result.batches);setLoaded(true);setReadFailed(false)
    }catch(cause){setReadFailed(true);throw cause}
  }
  async function open(id:string){setBatch(await authedJson(account,'/admin/refunds/'+id))}
  const candidates=payments.filter(row=>row.deployment_id&&[...reviewStates,...prepareStates].includes(row.state))
  const eligible=candidates.filter(row=>selected.includes(row.hash)),reviewable=eligible.filter(row=>reviewStates.includes(row.state))
  const locked=busy||readFailed||!loaded
  // Aggregate exact original fees only. Partial repayment remains a batch-level
  // outstanding amount, never silently substituted for the original payment.
  const selectedWei=originalFees(eligible),approvalWei=originalFees(reviewable)
  const knownBatches=batches.map(row=>batch?.id===row.id?{...row,state:batch.state}:row)
  function download(){const url=URL.createObjectURL(new Blob([batch.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='refund-'+batch.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  /** These controls navigate within the current review, not the application's
   * route/hash. They cannot approve a request or submit a payment implicitly. */
  function focusSection(node:HTMLElement|null){node?.scrollIntoView?.({block:'start',behavior:'smooth'})}
  return <Stack as='section' aria-label='Refund management'>
    <Row><Heading><AdminKicker>External creation-fee refunds</AdminKicker><h2>Refund requests</h2><FinePrint>Review requests, prepare external payouts, and verify repayment.</FinePrint></Heading><AdminOutline disabled={busy} onClick={()=>void run(()=>load())}>{busy?'Loading refunds…':loaded?'Refresh refunds':'Load refund requests'}</AdminOutline></Row>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
    {readFailed&&<FinePrint role='status'>{loaded?'Last loaded evidence is retained. ':''}Refresh refunds successfully before approving or preparing a batch.</FinePrint>}
    <Summary aria-label='Refund summary'>
      <div><dt>Needs review</dt><dd>{loaded?candidates.filter(row=>reviewStates.includes(row.state)).length:'—'}</dd><small>Loaded deployment requests</small></div>
      <div><dt>Approved</dt><dd>{loaded?candidates.filter(row=>row.state==='refund_pending').length:'—'}</dd><small>Exceptions are labeled separately</small></div>
      <div><dt>Submitted batches</dt><dd>{loaded?knownBatches.filter(row=>row.state==='submitted').length:'—'}</dd><small>Open a batch for verification status</small></div>
      <div><dt>Selected original fees</dt><dd><AdminGold>{loaded?eth(selectedWei):'—'}</AdminGold>{loaded&&selectedWei!==null&&<small>ETH</small>}</dd><small>Network gas not included</small></div>
    </Summary>
    <Stages aria-label='Refund workflow'>
      <li><button type='button' onClick={()=>focusSection(reviewRef.current)}><span>01</span>Review requests</button></li>
      <li><button type='button' onClick={()=>focusSection(prepareRef.current)}><span>02</span>Prepare batch</button></li>
      <li><button type='button' onClick={()=>focusSection(verifyRef.current)}><span>03</span>Verify repayment</button></li>
    </Stages>
    <ReviewGrid ref={reviewRef}>
      <AdminPanel><Stack>
        <Row><Heading><AdminKicker>01 / Request selection</AdminKicker><h2>Choose requests to review</h2></Heading><FinePrint>{loaded?`${candidates.length} requests loaded`:'Not loaded'}</FinePrint></Row>
        {!loaded?<Empty>Load refund requests to review their original fees and current status.</Empty>:!candidates.length?<Empty>No refund candidates in the loaded requests.</Empty>:<TableFrame><RequestTable aria-label='Refund requests'><thead><tr><th scope='col'><VisuallyHidden>Select request</VisuallyHidden></th><th scope='col'>Request / recipient</th><th scope='col'>Original fee</th><th scope='col'>Status</th></tr></thead><tbody>{candidates.map(row=><tr key={row.hash} data-selected={selected.includes(row.hash)||undefined}>
          <td><input type='checkbox' aria-label={'Select refund request '+row.hash} disabled={locked} checked={selected.includes(row.hash)} onChange={e=>setSelected(values=>e.target.checked?[...values,row.hash]:values.filter(hash=>hash!==row.hash))}/></td>
          <td><strong>{row.deployment_id.slice(0,8)}</strong><code>{row.wallet}</code><details><summary>Request reference</summary><code>{row.deployment_id}</code><code>{row.hash}</code></details></td>
          <td><span>{eth(row.amount_wei)}</span><small>ETH · original fee</small></td>
          <td><AdminBadge $tone={row.state==='refund_pending'?'approved':'review'}>{paymentLabel(row.state)}</AdminBadge></td>
        </tr>)}</tbody></RequestTable></TableFrame>}
        <Row><FinePrint>{eligible.length} selected · original fees only</FinePrint>{cursor&&<AdminOutline disabled={busy} onClick={()=>void run(()=>load(cursor))}>More refund candidates</AdminOutline>}</Row>
        <FinePrint>Loaded requests only{cursor?' · more requests available':''}. Batch summaries cover the latest 100 batches; submitted does not mean repaid.</FinePrint>
        <Notice>Repay the original fee in ETH on Robinhood. Network gas and bulk-sender fees are separate.</Notice>
      </Stack></AdminPanel>
      <ReviewPanel aria-label='Review selected refunds'><Stack>
        <Heading><AdminKicker>{reviewable.length} requests selected for approval</AdminKicker><h2>Review full-fee refunds</h2></Heading>
        <Row><FinePrint>Original fees to approve</FinePrint><AdminGold>{loaded?eth(approvalWei):'—'}{loaded&&approvalWei!==null&&<small>ETH</small>}</AdminGold></Row>
        <FormScope disabled={locked}>
          <AdminField>Unfulfillable reason<select value={category} onChange={e=>setCategory(e.target.value)}><option value='deployment_failed'>Deployment cannot be completed</option><option value='funding_unavailable'>Required premium cannot be funded</option></select></AdminField>
          <AdminField>Operator explanation<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></AdminField>
          <AdminCheck><input type='checkbox' checked={stopped} onChange={e=>setStopped(e.target.checked)}/> External funder has stopped work for these requests</AdminCheck>
          <AdminAction aria-label='Approve selected full-fee refunds and stop creation' disabled={locked||approvalWei===null||!stopped||reason.trim().length<3||!reviewable.length} onClick={()=>void run(async()=>{
            for(const row of reviewable)await authedJson(account,'/admin/payments/'+row.hash+'/refund',{revision:row.revision,requestKey:key('approve:'+row.hash+':'+row.revision+':'+category+':'+reason),reason,category,fundingStopped:stopped})
            await load()
          })}>Approve {reviewable.length||'selected'} full-fee refunds</AdminAction>
        </FormScope>
        <FinePrint>Approval stops creation. It does not send funds.</FinePrint>
        {eligible.length>reviewable.length&&<FinePrint>Already approved or exception requests are not approved again.</FinePrint>}
      </Stack></ReviewPanel>
    </ReviewGrid>
    <AdminPanel aria-label='Prepare refund batch' ref={prepareRef}><Stack>
      <Heading><AdminKicker>02 / External payout preparation</AdminKicker><h2>Prepare refund batch</h2><FinePrint>Select approved requests above. Reconcile exception requests before preparing a remaining-amount batch.</FinePrint></Heading>
      <PrepareRow><AdminField>Approved refund sender address<input value={source} disabled={locked} onChange={e=>setSource(e.target.value)} placeholder='0x…'/></AdminField>
        <AdminOutline disabled={locked||!/^0x[0-9a-fA-F]{40}$/.test(source)||!eligible.length||eligible.length!==selected.length||eligible.some(row=>!prepareStates.includes(row.state))} onClick={()=>void run(async()=>{
          const result=await authedJson(account,'/admin/refunds/prepare',{source,payments:selected,requestKey:key('prepare:'+source+':'+[...selected].sort().join(','))});setBatch(result);await load()
        })}>Prepare selected refund batch</AdminOutline>
      </PrepareRow>
    </Stack></AdminPanel>
    <BatchArea aria-label='Refund batches and verification' ref={verifyRef}>
      <Heading><AdminKicker>03 / Verify repayment</AdminKicker><h2>Refund batches</h2><FinePrint>Pay externally, then return with the transaction hashes. Opening a batch only reads its evidence.</FinePrint></Heading>
      {!loaded?<FinePrint>Load refund requests to see existing batches.</FinePrint>:!batches.length?<FinePrint>No refund batches in the loaded results.</FinePrint>:<BatchList>{knownBatches.map(row=><AdminOutline key={row.id} disabled={busy} aria-pressed={batch?.id===row.id} onClick={()=>void run(()=>open(row.id))}><span>Batch {row.id.slice(0,8)}</span><AdminBadge>{row.state.replaceAll('_',' ')}</AdminBadge><span aria-hidden='true'>→</span></AdminOutline>)}</BatchList>}
      {batch&&<AdminPanel aria-label={'Refund batch '+batch.id}><Stack>
        <Row><Heading><AdminKicker>Selected batch</AdminKicker><h3>Batch {batch.id}</h3><FinePrint>{batch.manifest.items.length} original payments · {batch.manifest.recipients.length} recipients</FinePrint></Heading><div><FinePrint>Outstanding original fee</FinePrint><AdminGold>{eth(batch.outstandingWei)}<small>ETH</small></AdminGold></div></Row>
        <Notice>CSV contains the frozen manifest, not an instruction to repeat a submitted payout. Pay externally through bulksender.app and return with its transaction hashes.</Notice>
        <Row><AdminOutline onClick={download}>Download original batch CSV</AdminOutline><AdminOutline disabled={busy} onClick={()=>void run(()=>open(batch.id))}>Refresh refund verification</AdminOutline></Row>
        <AdminField>External transaction hashes, one per line<textarea value={hashes} onChange={e=>setHashes(e.target.value)}/></AdminField>
        <AdminOutline disabled={busy||!hashes.trim()||batch.state==='superseded'} onClick={()=>void run(async()=>{setBatch(await authedJson(account,'/admin/refunds/'+batch.id+'/submit',{hashes:hashes.trim().split(/[\s,]+/)}));setHashes('')})}>Record hashes for verification</AdminOutline>
        {batch.submissions.map((row:any)=><Evidence key={row.hash}>{row.hash} · {row.state}{row.error?' · '+programText(row.error):''}</Evidence>)}
        {batch.items.map((row:any)=><Evidence key={row.hash}>{row.hash} · {paymentLabel(row.state)} · {eth(row.verifiedWei)} ETH verified / {eth(row.originalWei)} ETH owed{row.closureError?' · '+programText(row.closureError):''}</Evidence>)}
        {batch.unmatched.length>0&&<ErrorText>{batch.unmatched.length} surplus or unmatched payouts require review.</ErrorText>}
        <AdminOutline disabled={busy||batch.state==='superseded'||BigInt(batch.outstandingWei)===0n} onClick={()=>void run(async()=>{await authedJson(account,'/admin/refunds/'+batch.id+'/remainder',{});keys.current.clear();setSelected(batch.items.filter((row:any)=>BigInt(row.outstandingWei)>0n).map((row:any)=>row.hash));await load();await open(batch.id)})}>Close reconciled manifest to prepare a remaining-amount batch</AdminOutline>
      </Stack></AdminPanel>}
    </BatchArea>
  </Stack>
}

const Heading=styled.div`display:flex;flex-direction:column;gap:9px;min-width:0;h2,h3{margin:0;font:400 24px/1.3 ${p=>p.theme.fonts.display};overflow-wrap:anywhere}`
const Summary=styled.dl`display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border:1px solid #302a34;border-radius:9px;background:#080808;>div{min-width:0;padding:20px 22px;border-right:1px solid #242026}>div:last-child{border:0}dt,small{font-size:11px;color:#a99aae;line-height:1.5}dd{margin:8px 0;font:400 30px/1.3 ${p=>p.theme.fonts.display};font-variant-numeric:tabular-nums;overflow-wrap:anywhere;small{margin-left:8px}}@media(max-width:950px){grid-template-columns:repeat(2,minmax(0,1fr));>div:nth-child(2){border-right:0}>div:nth-child(-n+2){border-bottom:1px solid #242026}}@media(max-width:370px){grid-template-columns:minmax(0,1fr);>div{border-right:0;border-bottom:1px solid #242026}}`
const Stages=styled.ol`display:flex;gap:26px;flex-wrap:wrap;list-style:none;padding:0;margin:0;li:not(:last-child)::after{content:' ';display:inline-block;width:28px;height:1px;background:#403147;margin-left:20px;vertical-align:middle}button{min-height:44px;border:0;background:none;color:#cdb9d8;cursor:pointer;font:400 13px ${p=>p.theme.fonts.body};padding:0;display:inline-flex;align-items:center;gap:10px}span{display:inline-grid;place-items:center;width:28px;height:28px;border:1px solid #775189;background:#291b34;border-radius:50%;font:10px ${p=>p.theme.fonts.mono};color:#ead2f5}button:focus-visible{outline:2px solid #d286ff;outline-offset:3px}@media(max-width:650px){gap:10px;li:not(:last-child)::after{display:none}button{font-size:12px}}`
const ReviewGrid=styled.section`display:grid;grid-template-columns:minmax(0,1.46fr) minmax(0,1fr);gap:24px;align-items:stretch;@media(max-width:1050px){grid-template-columns:minmax(0,1fr)}`
const ReviewPanel=styled(AdminPanel)`border-color:#654672;background:linear-gradient(155deg,#18101e,#09090b 80%);`
const FormScope=styled.fieldset`display:flex;flex-direction:column;gap:18px;min-width:0;padding:20px 0 0;margin:0;border:0;border-top:1px solid #302a34;`
const TableFrame=styled.div`min-width:0;width:100%;overflow-x:auto;`
const RequestTable=styled.table`width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;min-width:480px;th{text-align:left;color:#a99aae;font-weight:400;font-size:11px;padding:0 8px 15px}th:first-child{width:7%}th:nth-child(2){width:35%}th:nth-child(3){width:27%;text-align:right}td{border-top:1px solid #302a34;padding:18px 8px;vertical-align:middle;overflow-wrap:anywhere}td:first-child input{width:17px;height:17px;accent-color:#ae6ac9;color-scheme:dark;margin:0}td:nth-child(2) strong{font:400 17px ${p=>p.theme.fonts.display}}code{display:block;color:#ab9ab6;font:10px/1.65 ${p=>p.theme.fonts.mono};overflow-wrap:anywhere;margin-top:7px}td:nth-child(3){text-align:right;font-variant-numeric:tabular-nums}td:nth-child(3)>span{font:400 21px ${p=>p.theme.fonts.display}}small{display:block;color:#a99aae;font-size:10px;margin-top:5px}tr[data-selected] td{background:#170f1c;border-color:#624270}tr[data-selected] td:first-child{box-shadow:inset 2px 0 #b37cca}details{margin-top:8px}summary{font-size:10px;color:#b79cc5;cursor:pointer;min-height:24px}input:focus-visible,summary:focus-visible{outline:2px solid #d286ff;outline-offset:3px}`
const VisuallyHidden=styled.span`position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;`
const Notice=styled.p`margin:0;padding:13px 16px;border:1px solid #494032;background:#14110b;border-radius:7px;color:#c9bda8;font-size:12px;line-height:1.6;`
const Empty=styled.p`margin:0;padding:24px 0;color:#b6a9bf;font-size:13px;line-height:1.6;`
const PrepareRow=styled.div`display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;>label{flex:1;min-width:min(100%,260px)}@media(max-width:650px){flex-direction:column;align-items:stretch;>label{width:100%}}`
const BatchArea=styled.section`display:flex;flex-direction:column;gap:20px;min-width:0;`
const BatchList=styled.div`display:flex;flex-direction:column;gap:12px;>button{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;text-align:left;padding:18px 22px;background:#080808}button[aria-pressed=true]{border-color:#ad75c8;background:#170f1c}`
const Evidence=styled(FinePrint)`padding:12px 0;border-top:1px solid #302a34;overflow-wrap:anywhere;`
