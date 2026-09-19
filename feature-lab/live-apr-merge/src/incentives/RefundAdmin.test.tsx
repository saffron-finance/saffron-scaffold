import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {RefundAdmin} from './RefundAdmin'

// Tests written against the pre-redesign component. Only the authenticated
// HTTP boundary is mocked; these cases never sign, transfer or contact a chain.
const api=vi.hoisted(()=>({authed:vi.fn()}))
vi.mock('../host/transport',()=>({authedJson:api.authed}))
const account='0x1111111111111111111111111111111111111111'
const sender='0x2222222222222222222222222222222222222222'
const hash=(digit:string)=>'0x'+digit.repeat(64)
const payment=(digit:string,state:string,amount:string)=>({hash:hash(digit),deployment_id:'request'+digit+'-full-reference',wallet:account,revision:7,state,amount_wei:amount})
const first=payment('1','admitted','4000000000000001'),second=payment('2','needs_attention','200000000000002'),approved=payment('3','refund_pending','4000000000000000')
let payments:any[],batch:any,batches:any[],cursor:string|null,rejectApproval:boolean,rejectRead:boolean
const writes=()=>api.authed.mock.calls.filter(call=>call.length===3)
/** Both the old disclosure and the selected R1 surface expose the same reads. */
function show(){const view=render(<ThemeProvider theme={darkTheme}><RefundAdmin account={account}/></ThemeProvider>);const summary=screen.queryByText('External creation-fee refunds',{selector:'summary'});if(summary)fireEvent.click(summary);return view}
async function load(){fireEvent.click(screen.getByRole('button',{name:/Load refundable requests and batches|Load refund requests|Refresh refunds/}));await screen.findByRole('checkbox',{name:new RegExp('request1|'+first.hash)});await waitFor(()=>expect(screen.getByRole('button',{name:/Load refundable requests and batches|Load refund requests|Refresh refunds/})).toBeEnabled())}
function choose(row:any){fireEvent.click(screen.getByRole('checkbox',{name:new RegExp(row.deployment_id.slice(0,8)+'|'+row.hash)}))}
const approve=()=>screen.getByRole('button',{name:'Approve selected full-fee refunds and stop creation'})
const prepare=()=>screen.getByRole('button',{name:'Prepare selected refund batch'})
function reason(){fireEvent.change(screen.getByLabelText('Unfulfillable reason'),{target:{value:'funding_unavailable'}});fireEvent.change(screen.getByLabelText('Operator explanation'),{target:{value:'Required premium cannot be funded.'}});fireEvent.click(screen.getByRole('checkbox',{name:/External funder has stopped work/}))}
beforeEach(()=>{
 api.authed.mockReset();payments=[structuredClone(first),structuredClone(second),structuredClone(approved),{...payment('4','confirmed','9'),deployment_id:null}];cursor=null;rejectApproval=false;rejectRead=false
 batch={id:'batch-original',state:'prepared',outstandingWei:'4000000000000000',csv:'recipient,amount\n'+account+',0.004\n',manifest:{items:[{hash:approved.hash}],recipients:[{wallet:account}]},items:[{hash:approved.hash,state:'refund_pending',verifiedWei:'0',originalWei:'4000000000000000',outstandingWei:'4000000000000000'}],submissions:[],unmatched:[]}
 batches=[{id:batch.id,state:batch.state}]
 api.authed.mockImplementation(async(_account,path,body)=>{
  if(body===undefined){
   if(path.startsWith('/admin/payments?')){if(rejectRead)throw Error('Refund list unavailable.');return {payments:structuredClone(path.includes('cursor=')?[payment('5','needs_attention','1')]:payments),nextCursor:path.includes('cursor=')?null:cursor}}
   if(path==='/admin/refunds')return {batches:structuredClone(batches)}
   if(path==='/admin/refunds/'+batch.id)return structuredClone(batch)
  }
  if(path.match(/^\/admin\/payments\/0x[0-9a-f]+\/refund$/)){
   if(rejectApproval){rejectApproval=false;throw Error('Reply unavailable; retry.')}
   const row=payments.find(p=>path.includes(p.hash));row.state='refund_pending';row.revision++;return {ok:true}
  }
  if(path==='/admin/refunds/prepare')return structuredClone(batch)
  if(path==='/admin/refunds/'+batch.id+'/submit'){batch.submissions=body.hashes.map((hash:string)=>({hash,state:'pending'}));return structuredClone(batch)}
  if(path==='/admin/refunds/'+batch.id+'/remainder'){batch.state='superseded';return {ok:true}}
  throw Error('Unexpected refund fixture request: '+path)
 })
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})

it('loads only on request, retains paginated candidates and excludes non-deployment payments',async()=>{
 cursor='page-two';show();expect(api.authed).not.toHaveBeenCalled();await load()
 expect(screen.getAllByRole('checkbox')).toHaveLength(4)
 choose(first);fireEvent.click(screen.getByRole('button',{name:'More refund candidates'}))
 await screen.findByRole('checkbox',{name:/request5|0x5555/})
 expect(screen.getByRole('checkbox',{name:new RegExp('request1|'+first.hash)})).toBeChecked()
 expect(api.authed).toHaveBeenCalledWith(account,'/admin/payments?all=true&limit=100&cursor=page-two')
 expect(writes()).toHaveLength(0)
})
it('requires a stopped funder and reason, and approves only reviewable selections with original revisions',async()=>{
 show();await load();choose(first);choose(second);choose(approved)
 expect(approve()).toBeDisabled();fireEvent.change(screen.getByLabelText('Operator explanation'),{target:{value:'ok'}});expect(approve()).toBeDisabled()
 reason();expect(approve()).toBeEnabled();fireEvent.click(approve())
 await waitFor(()=>expect(writes()).toHaveLength(2))
 for(const [index,row]of [first,second].entries())expect(writes()[index]).toEqual([account,'/admin/payments/'+row.hash+'/refund',{revision:7,requestKey:expect.any(String),reason:'Required premium cannot be funded.',category:'funding_unavailable',fundingStopped:true}])
 expect(writes().every(call=>!call[1].includes('/prepare'))).toBe(true)
})
it('retries uncertain approval with its identical idempotency key and payload',async()=>{
 show();await load();choose(first);reason();rejectApproval=true;fireEvent.click(approve());await screen.findByText('Reply unavailable; retry.')
 const original=structuredClone(writes()[0]);fireEvent.click(approve());await waitFor(()=>expect(writes()).toHaveLength(2));expect(writes()[1]).toEqual(original)
})
it('prepares only approved selections with a valid external sender and unchanged payment hashes',async()=>{
 show();await load();choose(first);fireEvent.change(screen.getByLabelText('Approved refund sender address'),{target:{value:sender}});expect(prepare()).toBeDisabled()
 choose(first);choose(approved);fireEvent.change(screen.getByLabelText('Approved refund sender address'),{target:{value:'not-a-wallet'}});expect(prepare()).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Approved refund sender address'),{target:{value:sender}});fireEvent.click(prepare())
 await screen.findByRole('button',{name:'Download original batch CSV'})
 expect(writes()).toEqual([[account,'/admin/refunds/prepare',{source:sender,payments:[approved.hash],requestKey:expect.any(String)}]])
})
it('keeps original CSV, hash verification, outstanding amounts and reconciliation available',async()=>{
 show();await load();fireEvent.click(screen.getByRole('button',{name:/Batch batch-or/}));await screen.findByRole('button',{name:'Download original batch CSV'})
 const blob=vi.fn(()=> 'blob:fixture');Object.defineProperty(URL,'createObjectURL',{value:blob,configurable:true});Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true})
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});fireEvent.click(screen.getByRole('button',{name:'Download original batch CSV'}));expect(click).toHaveBeenCalledOnce();expect(blob.mock.calls[0][0]).toBeInstanceOf(Blob)
 const tx=hash('a');fireEvent.change(screen.getByLabelText('External transaction hashes, one per line'),{target:{value:'  '+tx+'\n'+hash('b')+' '}});fireEvent.click(screen.getByRole('button',{name:'Record hashes for verification'}))
 await waitFor(()=>expect(writes()[0]).toEqual([account,'/admin/refunds/'+batch.id+'/submit',{hashes:[tx,hash('b')]}]))
 expect(screen.getByLabelText('External transaction hashes, one per line')).toHaveValue('')
 fireEvent.click(screen.getByRole('button',{name:'Close reconciled manifest to prepare a remaining-amount batch'}))
 await waitFor(()=>expect(writes()).toHaveLength(2));expect(writes()[1]).toEqual([account,'/admin/refunds/'+batch.id+'/remainder',{}])
 await waitFor(()=>expect(screen.getByRole('button',{name:'Record hashes for verification'})).toBeDisabled())
})
it('shows partial, unmatched and superseded evidence without allowing another submission',async()=>{
 batch.state='superseded';batch.unmatched=[{hash:hash('a')}];batch.items[0].verifiedWei='1';batch.items[0].closureError='A canonical repayment is still pending.';batch.submissions=[{hash:hash('a'),state:'unmatched',error:'Wrong recipient.'}]
 show();await load();fireEvent.click(screen.getByRole('button',{name:/Batch batch-or/}));await screen.findByText(/surplus or unmatched payouts require review/)
 expect(screen.getByText(/A canonical repayment is still pending/)).toBeVisible();expect(screen.getByText(/Wrong recipient/)).toBeVisible()
 fireEvent.change(screen.getByLabelText('External transaction hashes, one per line'),{target:{value:hash('b')}})
 expect(screen.getByRole('button',{name:'Record hashes for verification'})).toBeDisabled();expect(screen.getByRole('button',{name:'Close reconciled manifest to prepare a remaining-amount batch'})).toBeDisabled();expect(writes()).toHaveLength(0)
})
it('surfaces a failed read and an empty request list without fabricating financial records',async()=>{
 show();rejectRead=true;fireEvent.click(screen.getByRole('button',{name:/Load refundable requests and batches|Load refund requests/}));await screen.findByRole('alert');expect(approve()).toBeDisabled();expect(prepare()).toBeDisabled()
 rejectRead=false;payments=[];fireEvent.click(screen.getByRole('button',{name:/Load refundable requests and batches|Load refund requests|Refresh refunds/}));await waitFor(()=>expect(screen.getByRole('button',{name:/Load refundable requests and batches|Load refund requests|Refresh refunds/})).toBeEnabled());expect(screen.getAllByRole('checkbox')).toHaveLength(1);expect(writes()).toHaveLength(0)
})
