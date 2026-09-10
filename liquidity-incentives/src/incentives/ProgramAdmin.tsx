import { useEffect, useState,cloneElement,type ReactElement, type ReactNode, type FormEvent } from 'react'
import { formatUnits,parseUnits,type Address } from 'viem'
import styled from 'styled-components'
import { authedJson } from '../host/transport'
import { normalizePair,normalizeProgram } from '../../shared/incentives.mjs'
import type { Pair as IncentivePair,Program as IncentiveProgram,Budget } from './model'
type AdminCatalog={pairs:IncentivePair[];programs:IncentiveProgram[];budgets:Budget[]}
const validPair=(value:any)=>{try{normalizePair(value);return true}catch{return false}}
const validProgram=(value:any)=>{try{normalizeProgram(value);return true}catch{return false}}
const centsValue=(value:string)=>String(Math.round(Number(value)*100))
import { ErrorText, FinePrint, QuietButton, Row, Stack } from './styles'

/** An optional admin disclosure keeps catalog maintenance out of the offer list. */
export function ProgramAdmin({ account, onConnect }: { account: Address | null; onConnect: () => void }) {
  const [catalog, setCatalog] = useState<{ wallet: Address; data: AdminCatalog } | null>(null)
  const [pair, setPair] = useState<IncentivePair | null>(null)
  const [program, setProgram] = useState<IncentiveProgram | null>(null)
  const [budget,setBudget]=useState<Budget|null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState<string>()
  useEffect(() => { setCatalog(null); setPair(null); setProgram(null); setBudget(null); setError(undefined); setSaved(undefined) }, [account])
  const current = catalog?.wallet === account ? catalog.data : null
  async function run(action: 'list' | 'save-pair' | 'save-program' | 'save-budget') {
    if (!account) { onConnect(); return }
    setBusy(true); setError(undefined); setSaved(undefined)
    try {
      if(action!=='list')await authedJson(account,'/admin/'+(action==='save-pair'?'pairs':action==='save-program'?'programs':'budgets'),(action==='save-pair'?pair:action==='save-program'?program:budget)!)
      const data=await authedJson(account,'/admin/catalog')
      window.dispatchEvent(new Event('saffron:catalog-updated'))
      setCatalog({ wallet: account, data }); setPair(null); setProgram(null); setBudget(null)
      if (action !== 'list') setSaved('Catalog saved. Updated offers are now available.')
    } catch (cause) { setError(cause instanceof Error ? cause.message.split('\n')[0] : 'The catalog could not be saved.') }
    finally { setBusy(false) }
  }
  const editPair = (value: IncentivePair) => { setBudget(null); setProgram(null); setPair(structuredClone(value)); setSaved(undefined) }
  const editProgram = (value: IncentiveProgram) => { setBudget(null); setPair(null); setProgram(structuredClone(value)); setSaved(undefined) }
  return <Stack>
    <FinePrint>Manage pairs, programs and cumulative premium budgets. Pausing a budget preserves its existing commitments and stops new deployment and funding transactions.</FinePrint>
    <Row><QuietButton onClick={() => void run('list')} disabled={busy}>{busy ? 'Waiting for admin action…' : current ? 'Reload catalog' : 'Load incentive catalog'}</QuietButton></Row>
    {error && <ErrorText role='alert'>{error}</ErrorText>}
    {saved && <FinePrint role='status'>{saved}</FinePrint>}
    {current && <>
      <Row><b>Pairs</b><QuietButton disabled={busy} onClick={() => editPair({ id: '', revision: 0, chainId: 4663, pool: '0x', feeTier: 10000,
        token0: { address: '0x', symbol: '', decimals: 18 }, token1: { address: '0x', symbol: '', decimals: 18 }, active: true })}>Add pair</QuietButton></Row>
      <Items>{current.pairs.map(value => <li key={value.id}><span>{value.token0.symbol} / {value.token1.symbol} · {value.feeTier / 10000}%{!value.active && ' · Paused'}</span>
        <QuietButton disabled={busy} aria-label={`Edit pair ${value.id}`} onClick={() => editPair(value)}>Edit</QuietButton></li>)}</Items>
      <Row><b>Campaign budgets</b><QuietButton disabled={busy||!current.pairs.length} onClick={()=>{setPair(null);setProgram(null);setBudget({id:'',revision:0,name:'',chainId:4663,rewardAsset:current.pairs[0].token0.address,decimals:current.pairs[0].token0.decimals,limitRaw:'0',reservedRaw:'0',allocatedRaw:'0',availableRaw:'0',paused:true,reconciliationRequired:false})}}>Add budget</QuietButton></Row>
      <Items>{current.budgets.map(value=><li key={value.id}><span>{value.name}{value.paused?' · Paused':''}{value.reconciliationRequired?' · Reconciliation required':''}<FinePrint>Reserved {formatUnits(BigInt(value.reservedRaw),value.decimals)} · allocated/spent {formatUnits(BigInt(value.allocatedRaw),value.decimals)} · available {formatUnits(BigInt(value.availableRaw),value.decimals)}</FinePrint></span>
        <QuietButton onClick={()=>{setPair(null);setProgram(null);setBudget(value)}}>Edit {value.id}</QuietButton></li>)}</Items>
      {budget&&<Editor key={budget.revision?budget.id+budget.revision:'new-budget'} onSubmit={(event:FormEvent)=>{event.preventDefault();void run('save-budget')}}><b>{budget.revision?'Edit budget':'Add budget'}</b><Fields>
        <Field label='Budget ID'><input required pattern='[a-z0-9][a-z0-9-]{0,79}' value={budget.id} disabled={budget.revision>0} onChange={e=>setBudget({...budget,id:e.target.value})}/></Field>
        <Field label='Campaign name'><input required value={budget.name} onChange={e=>setBudget({...budget,name:e.target.value})}/></Field>
        <Field label='Reward token'><select value={budget.rewardAsset} disabled={budget.revision>0} onChange={e=>{const token=current.pairs.find(p=>p.token0.address===e.target.value)!.token0;setBudget({...budget,rewardAsset:token.address,decimals:token.decimals})}}>{current.pairs.filter((p,i,all)=>all.findIndex(v=>v.token0.address===p.token0.address)===i).map(p=><option key={p.token0.address} value={p.token0.address}>{p.token0.symbol} ({p.token0.address})</option>)}</select></Field>
        <Field label='Cumulative token limit'><input required inputMode='decimal' defaultValue={formatUnits(BigInt(budget.limitRaw),budget.decimals)} onChange={e=>{const value=e.target.value;const valid=/^\d+(\.\d*)?$/.test(value)&&(value.split('.')[1]?.length??0)<=budget.decimals;e.target.setCustomValidity(valid?'':'Enter an exact token amount using at most '+budget.decimals+' decimal places.');if(valid)setBudget({...budget,limitRaw:parseUnits(value,budget.decimals).toString()})}}/></Field>
      </Fields><Check><input type='checkbox' checked={budget.paused} onChange={e=>setBudget({...budget,paused:e.target.checked})}/>Pause new deployments and funding</Check>
      <FinePrint>The limit counts both reservations and funded premiums, including premiums already claimed. Maturity does not reset it.</FinePrint>
      {budget.reconciliationRequired&&<QuietButton disabled={busy} onClick={async()=>{if(!account)return;setBusy(true);try{await authedJson(account,'/admin/budgets/'+budget.id+'/reconcile',{});await run('list')}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}}>Reconcile and keep paused</QuietButton>}
      <Row><QuietButton type='button' disabled={busy} onClick={()=>setBudget(null)}>Cancel edit</QuietButton><QuietButton type='submit' disabled={busy}>Save budget</QuietButton></Row></Editor>}
      <Row><b>Programs</b><QuietButton disabled={busy || !current.pairs.length || !current.budgets.length} onClick={() => editProgram({ id: '', revision: 0,
        pairId: current.pairs.find(value => value.active)?.id ?? current.pairs[0].id, budgetPoolId:current.budgets[0].id, apr: 1, days: 1, minimumCents: '10000',maximumCents: '100000',
        sortOrder: current.programs.length, isNew: false, active: true })}>Add program</QuietButton></Row>
      <Items>{current.programs.map(value => <li key={value.id}><span>{value.id} · {value.apr.toLocaleString()}% · {value.days} days{!value.active && ' · Paused'}</span>
        <QuietButton disabled={busy} aria-label={`Edit program ${value.id}`} onClick={() => editProgram(value)}>Edit</QuietButton></li>)}</Items>
      {pair && <Editor onSubmit={(event: FormEvent) => { event.preventDefault(); if (validPair(pair)) void run('save-pair') }}>
        <b>{pair.revision ? 'Edit pair' : 'Add pair'}</b>
        <Fields>
          <Field label='Pair ID'><input required pattern='[a-z0-9][a-z0-9-]{0,79}' value={pair.id} disabled={busy || pair.revision > 0} onChange={e => setPair({ ...pair, id: e.target.value })} /></Field>
          <Field label='Pool address'><input required value={pair.pool} disabled={busy} onChange={e => setPair({ ...pair, pool: e.target.value as Address })} /></Field>
          <Field label='Pool fee'><select value={pair.feeTier} disabled={busy} onChange={e => setPair({ ...pair, feeTier: Number(e.target.value) })}>
            {[100,500,3000,10000].map(fee => <option key={fee} value={fee}>{fee / 10000}%</option>)}</select></Field>
          {(['token0', 'token1'] as const).map((key, index) => <TokenFields key={key}>
            <legend>{index === 0 ? 'Yield token' : 'Paired token'}</legend>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token address`}><input required value={pair[key].address} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], address: e.target.value as Address } })} /></Field>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token symbol`}><input required maxLength={20} pattern='[A-Za-z0-9._\-]+' value={pair[key].symbol} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], symbol: e.target.value } })} /></Field>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token decimals`}><input required type='number' min={0} max={18} value={pair[key].decimals} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], decimals: Number(e.target.value) } })} /></Field>
          </TokenFields>)}
        </Fields>
        <Check><input type='checkbox' checked={pair.active} disabled={busy} onChange={e => setPair({ ...pair, active: e.target.checked })} />Pair active</Check>
        <FinePrint>Robinhood Chain, full range. Pausing a pair hides all its programs. Pool tokens, decimals, and fee are checked on-chain when saving.</FinePrint>
        <Row><QuietButton type='button' disabled={busy} onClick={() => setPair(null)}>Cancel edit</QuietButton><QuietButton type='submit' disabled={busy || !validPair(pair)}>Save pair</QuietButton></Row>
      </Editor>}
      {program && <Editor key={program.revision?program.id+program.revision:'new-program'} onSubmit={(event: FormEvent) => { event.preventDefault(); if (validProgram(program)) void run('save-program') }}>
        <b>{program.revision ? 'Edit program' : 'Add program'}</b>
        <Fields>
          <Field label='Program ID'><input required pattern='[a-z0-9][a-z0-9-]{0,79}' value={program.id} disabled={busy || program.revision > 0} onChange={e => setProgram({ ...program, id: e.target.value })} /></Field>
          <Field label='Program pair'><select value={program.pairId} disabled={busy} onChange={e => setProgram({ ...program, pairId: e.target.value })}>{current.pairs.map(value => <option key={value.id} value={value.id}>{value.token0.symbol} / {value.token1.symbol} ({value.id}){!value.active && ' · Paused'}</option>)}</select></Field>
          <Field label='APR (%)'><input required type='number' min={0.01} max={100000} step={0.01} value={program.apr} disabled={busy} onChange={e => setProgram({ ...program, apr: Number(e.target.value) })} /></Field>
          <Field label='Duration (days)'><input required type='number' min={1} max={3650} value={program.days} disabled={busy} onChange={e => setProgram({ ...program, days: Number(e.target.value) })} /></Field>
          <Field label='Campaign budget'><select value={program.budgetPoolId} onChange={e=>setProgram({...program,budgetPoolId:e.target.value})}>{current.budgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label='Minimum vault size (USD)'><input required type='number' min={0.01} step={0.01} defaultValue={Number(program.minimumCents)/100} onChange={e=>setProgram({...program,minimumCents:centsValue(e.target.value)})}/></Field>
          <Field label='Maximum vault size (USD)'><input required type='number' min={0.01} step={0.01} defaultValue={Number(program.maximumCents)/100} onChange={e=>setProgram({...program,maximumCents:centsValue(e.target.value)})}/></Field>
          <Field label='Display order'><input required type='number' min={-100000} max={100000} value={program.sortOrder} disabled={busy} onChange={e => setProgram({ ...program, sortOrder: Number(e.target.value) })} /></Field>
        </Fields>
        <Check><input type='checkbox' checked={program.active} disabled={busy} onChange={e => setProgram({ ...program, active: e.target.checked })} />Program active</Check>
        <Check><input type='checkbox' checked={program.isNew} disabled={busy} onChange={e => setProgram({ ...program, isNew: e.target.checked })} />Show NEW badge</Check>
        <FinePrint>Programs sharing a budget compete for the same cumulative premium capacity. Saving a program does not fund a vault.</FinePrint>
        <Row><QuietButton type='button' disabled={busy} onClick={() => setProgram(null)}>Cancel edit</QuietButton><QuietButton type='submit' disabled={busy || !validProgram(program)}>Save program</QuietButton></Row>
      </Editor>}
    </>}
  </Stack>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <FieldLabel>{label}{cloneElement(children as ReactElement,{'aria-label':label})}</FieldLabel> }
const Items = styled.ul`margin:0;padding:0;list-style:none;li{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #ffffff12;padding:6px 0;overflow-wrap:anywhere}span{min-width:0}button{flex-shrink:0;white-space:nowrap}`
const Editor = styled.form`display:flex;flex-direction:column;gap:18px;border-top:1px solid #ffffff25;padding-top:20px;`
const Fields = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;@media(max-width:650px){grid-template-columns:minmax(0,1fr)}`
const FieldLabel = styled.label`display:flex;flex-direction:column;gap:8px;font-size:12px;min-width:0;
  input,select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #7775;border-radius:6px;padding:10px;font:inherit;background:${p => p.theme.colors.background.base};color:${p => p.theme.colors.text.primary}}
  input:focus-visible,select:focus-visible{outline:2px solid ${p => p.theme.colors.accent.gold}}
  input:disabled{opacity:.6}`
const TokenFields = styled.fieldset`min-width:0;display:flex;flex-direction:column;gap:12px;border:1px solid #7775;border-radius:6px;padding:12px;legend{padding:0 4px}`
const Check = styled.label`display:flex;align-items:center;gap:10px;font-size:13px;input{width:16px;height:16px}`
