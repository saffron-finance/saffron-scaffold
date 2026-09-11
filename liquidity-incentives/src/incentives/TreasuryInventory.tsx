import { useState } from 'react'
import type { Address } from 'viem'
import { authedJson } from '../host/transport'
import { Disclosure,ErrorText,FinePrint,QuietButton,Stack } from './styles'

export function TreasuryInventory({account,onUpdate}:{account:Address;onUpdate:()=>void}){
  const [data,setData]=useState<any>(),[budgets,setBudgets]=useState<any[]>([]),[budgetId,setBudgetId]=useState(''),[wallet,setWallet]=useState(''),[limit,setLimit]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID())
  async function load(){const [catalog,status]=await Promise.all([authedJson(account,'/admin/catalog'),authedJson(account,'/admin/treasury')]);setBudgets(catalog.budgets);setData(status)}
  async function run(save=false){setBusy(true);setError('');try{
    if(save){await authedJson(account,'/admin/treasury',{budgetId,wallet,limitRaw:limit,revision:data?.allocations.find((a:any)=>a.budget_pool_id===budgetId)?.revision??0,reason,requestKey});setRequestKey(crypto.randomUUID());onUpdate()}
    await load()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>Treasury inventory allocations</summary><Stack>
    <FinePrint>Assign each campaign a lifetime raw-token spending ceiling backed by a named treasury wallet. The unspent portions of all allocations sharing that holding must fit its verified balance. No tokens move here.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void run()}>Verify treasury inventory</QuietButton>
    {data&&<><FinePrint>Inventory {data.available?'verified':'requires attention'} · block {BigInt(data.blockNumber).toString()}. {data.missing.length?'Unassigned campaigns: '+data.missing.join(', '):''} {data.insufficient.length?'Some holdings are below their assigned commitments.':''}</FinePrint>
      {data.allocations.map((a:any)=><FinePrint key={a.budget_pool_id} style={{overflowWrap:'anywhere'}}>{a.budget_pool_id} · treasury {a.wallet} · assigned {a.limit_raw} · spent {a.allocated_raw} · available {a.availableRaw} raw units.</FinePrint>)}
      <label>Allocation campaign<select value={budgetId} onChange={e=>{setBudgetId(e.target.value);setRequestKey(crypto.randomUUID());const a=data.allocations.find((a:any)=>a.budget_pool_id===e.target.value);setWallet(a?.wallet??'');setLimit(a?.limit_raw??'')}}><option value=''>Select campaign</option>{budgets.map(b=><option key={b.id} value={b.id}>{b.name} · {b.decimals} decimals</option>)}</select></label>
      <label>Treasury wallet<input value={wallet} onChange={e=>{setWallet(e.target.value);setRequestKey(crypto.randomUUID())}}/></label>
      <label>Lifetime allocation (raw token units)<input inputMode='numeric' value={limit} onChange={e=>{setLimit(e.target.value);setRequestKey(crypto.randomUUID())}}/></label>
      <label>Allocation reason<input value={reason} onChange={e=>{setReason(e.target.value);setRequestKey(crypto.randomUUID())}}/></label>
      <QuietButton disabled={busy||!budgetId||!wallet||!limit||reason.trim().length<8} onClick={()=>void run(true)}>Save treasury allocation</QuietButton>
    </>}{error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Stack></Disclosure>
}

export function FundingBrief({account,id}:{account:Address;id:string}){
  const [brief,setBrief]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false)
  async function refresh(copy=false){setBusy(true);setError('');setCopied(false);try{const result=await authedJson(account,'/admin/deployments/'+id+'/funding-brief');setBrief(result.brief);if(copy){await navigator.clipboard.writeText(JSON.stringify(result.brief,null,2));setCopied(true)}}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Disclosure><summary>External funding and recovery brief</summary>
    <FinePrint>Refresh before using these facts in the treasury wallet. Fund through the variable-side deposit; a plain token transfer does not count. The treasury depositor retains the variable bearer rights.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void refresh()}>Refresh funding brief</QuietButton>
    {brief&&<><FinePrint>{brief.action}</FinePrint><FinePrint>{brief.recovery}</FinePrint><textarea aria-label='Verified funding brief' readOnly value={JSON.stringify(brief,null,2)} rows={10} style={{width:'100%',boxSizing:'border-box'}}/><QuietButton disabled={busy} onClick={()=>void refresh(true)}>Refresh and copy funding brief</QuietButton>{copied&&<FinePrint>Verified brief copied.</FinePrint>}</>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
