import {programText} from './program-language'
import { useEffect,useState,type FormEvent } from 'react'
import { formatUnits,type Address } from 'viem'
import styled from 'styled-components'
import { campaignTerms as programTerms } from '../../shared/campaign.mjs'
import { requestFeeFromEth } from '../../shared/incentives.mjs'
import { authedJson } from '../host/transport'
import { usd,type Pair } from './model'
import { ErrorText,FinePrint,PrimaryAction,Row,Stack } from './styles'
import { Field,Fields,Panel,SaveButton,SectionIntro,poolHeading,useProgramCatalog } from './program-admin'

/** A dedicated route owns creation. Loading this page only reads the catalog;
 * the single explicit submission creates the program and budget atomically. */
export function CreateIncentiveProgramPage({account,onConnect,onBack}:{account:Address|null;onConnect:()=>void;onBack:()=>void}){
  const {catalog,busy,error,load}=useProgramCatalog(account,onConnect,true)
  const pairs=catalog?.pairs.filter(pair=>pair.active)??[]
  return <Stack>
    <FinePrint>Configure one incentive program. Required inputs are marked *. Nothing is created until you select Create incentive program.</FinePrint>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
    {!catalog||error?<Panel><SectionIntro><h2>{busy?'Loading incentive program setup…':'Operator access'}</h2><FinePrint>{account?'Load the supported pairs to configure a new incentive program.':'Connect an operator wallet to create an incentive program.'}</FinePrint></SectionIntro><SaveButton disabled={busy} onClick={()=>void load()}>{account?'Load incentive program setup':'Connect wallet'}</SaveButton></Panel>
      :pairs.length===0?<Panel><h2>No enabled pairs</h2><FinePrint>Add or enable a supported pair in Pair management before creating an incentive program.</FinePrint><SaveButton onClick={onBack}>Back to incentive programs</SaveButton></Panel>
      :account&&<IncentiveProgramEditor key={account} account={account} pairs={pairs} onBack={onBack} onSaved={()=>{window.dispatchEvent(new Event('saffron:catalog-updated'));onBack()}}/>}
  </Stack>
}

/** The computed economics field is read-only. Exact server helpers derive its
 * value from the other two inputs; displayed APR rounding never enters a quote. */
export function IncentiveProgramEditor({account,pairs,onBack,onSaved}:{account:Address;pairs:Pair[];onBack:()=>void;onSaved:()=>void}){
  // Retain this idempotency key on failed/ambiguous responses to prevent duplicates.
  const [creationKey]=useState(()=>crypto.randomUUID()),[pairId,setPairId]=useState(pairs[0]?.id??'')
  useEffect(()=>{if(!pairId&&pairs.length)setPairId(pairs[0].id)},[pairId,pairs])
  const [days,setDays]=useState('3'),[budget,setBudget]=useState('10000'),[capacity,setCapacity]=useState('1000000'),[apr,setApr]=useState('121.66666667')
  const [computed,setComputed]=useState('apr'),[active,setActive]=useState(false),[requestFee,setRequestFee]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const economics={days:Number(days),...(computed!=='budget'?{budgetUsd:budget}:{}),...(computed!=='capacity'?{capacityUsd:capacity}:{}),...(computed!=='apr'?{aprPercent:apr}:{})}
  let terms:any=null,validation='',feeWei:string|null=null,feeError=''
  try{terms=programTerms(economics)}catch(e){validation=programText((e as Error).message)}
  if(requestFee)try{feeWei=requestFeeFromEth(requestFee)}catch(e){feeError=programText((e as Error).message)}
  async function submit(event:FormEvent){
    event.preventDefault();if(busy||!terms||feeWei===null||!pairId)return
    setBusy(true);setError('')
    try{await authedJson(account,'/admin/campaigns',{creationKey,pairId,active,requestFeeWei:feeWei,...economics});onSaved()}
    catch(e){setError(programText((e as Error).message))}finally{setBusy(false)}
  }
  return <Form onSubmit={submit} aria-label='Create incentive program'><FormScope disabled={busy}>
    <Panel aria-labelledby='program-pool-title'><SectionIntro><Eyebrow>01 · Pool &amp; term</Eyebrow><h2 id='program-pool-title'>Choose the incentive program market</h2></SectionIntro><Fields>
      <Field>Pair *<select aria-label='Incentive program pair' required value={pairId} onChange={e=>setPairId(e.target.value)}><option value='' disabled>Select pair</option>{pairs.map(pair=><option key={pair.id} value={pair.id}>{poolHeading(pair)}</option>)}</select><FinePrint>Token pair and pool fee tier.</FinePrint></Field>
      <Field>Duration · days *<input aria-label='Incentive program duration' required type='number' min={1} max={3650} step={1} value={days} onChange={e=>setDays(e.target.value)}/><FinePrint>Whole days, from 1 to 3,650.</FinePrint></Field>
      {/* Only the full-range deployment adapter is supported by this workflow. */}
      <Field>Liquidity range · fixed<input aria-label='Range selection' readOnly value='Infinite range'/><FinePrint>This incentive program uses the full supported price range.</FinePrint></Field>
      <Field>Request fee · ETH *<input aria-label='Incentive program request fee ETH' aria-describedby='program-fee-help' required inputMode='decimal' placeholder='e.g. 0.001' value={requestFee} onChange={e=>setRequestFee(e.target.value)}/><FinePrint id='program-fee-help'>Fixed ETH per new request, plus wallet network gas. Not a USD price.</FinePrint></Field>
    </Fields>{feeError&&<ErrorText role='alert'>{feeError}</ErrorText>}</Panel>
    <Panel aria-labelledby='program-economics-title'><SectionIntro><Eyebrow>02 · Incentive program economics</Eyebrow><h2 id='program-economics-title'>Set two values; calculate the third</h2><FinePrint>Planning targets do not cap request count or size. APR uses a 365-day year, without compounding.</FinePrint></SectionIntro>
      <Field>Calculated field<select aria-label='Calculate incentive program field' value={computed} onChange={e=>setComputed(e.target.value)}><option value='apr'>APR from budget + capacity</option><option value='capacity'>Capacity from budget + APR</option><option value='budget'>Budget from capacity + APR</option></select></Field>
      <EconomicsFields>
        <Field>Budget · USD {computed==='budget'?'— calculated':'*'}<input aria-label='Incentive program budget USD' required={computed!=='budget'} inputMode='decimal' readOnly={computed==='budget'} value={computed==='budget'?(terms?formatUnits(BigInt(terms.budgetCents),2):''):budget} onChange={e=>setBudget(e.target.value)}/><FinePrint>Premium planning target.</FinePrint></Field>
        <Field>Fixed-side capacity · USD {computed==='capacity'?'— calculated':'*'}<input aria-label='Incentive program capacity USD' required={computed!=='capacity'} inputMode='decimal' readOnly={computed==='capacity'} value={computed==='capacity'?(terms?formatUnits(BigInt(terms.capacityCents),2):''):capacity} onChange={e=>setCapacity(e.target.value)}/><FinePrint>Target value of the fixed-side liquidity.</FinePrint></Field>
        <Field>Target APR · % {computed==='apr'?'— calculated':'*'}<input aria-label='Incentive program APR percent' required={computed!=='apr'} inputMode='decimal' readOnly={computed==='apr'} value={computed==='apr'?(terms?Number(terms.aprPercent).toFixed(6):''):apr} onChange={e=>setApr(e.target.value)}/><FinePrint>Annualized premium rate.</FinePrint></Field>
      </EconomicsFields>{validation&&<ErrorText role='alert'>{validation}</ErrorText>}
      <FinePrint>The premium rate stays fixed after quoting. Later planning-budget edits do not change quoted economics.</FinePrint>
    </Panel>
    <Panel aria-labelledby='program-review-title'><SectionIntro><Eyebrow>03 · Review &amp; create</Eyebrow><h2 id='program-review-title'>Initial availability</h2></SectionIntro>
      <Checkbox><input type='checkbox' checked={active} onChange={e=>setActive(e.target.checked)}/><span>Enable this program for new requests<small>Shared intake, funding, and service readiness still apply. Leave unchecked to create it disabled.</small></span></Checkbox>
      <Preview aria-label='Incentive program preview'><div><dt>Pair</dt><dd>{poolHeading(pairs.find(pair=>pair.id===pairId))}</dd></div><div><dt>Term</dt><dd>{terms?`${terms.days} days`:'Not valid yet'}</dd></div><div><dt>Request fee</dt><dd>{feeWei!==null?`${formatUnits(BigInt(feeWei),18)} ETH`:'Enter an ETH amount'}</dd></div><div><dt>Planning budget</dt><dd>{terms?usd(Number(terms.budgetCents)/100):'Not valid yet'}</dd></div></Preview>
      {error&&<ErrorText role='alert'>{error}</ErrorText>}
      <Row><SaveButton type='button' onClick={onBack}>Cancel</SaveButton><Submit disabled={busy||!terms||feeWei===null||!pairId}>{busy?'Creating incentive program…':'Create incentive program'}</Submit></Row>
    </Panel>
  </FormScope></Form>
}
const Form=styled.form`min-width:0;`
const FormScope=styled.fieldset`border:0;padding:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:22px;`
const Eyebrow=styled.div`font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${p=>p.theme.colors.accent.gold};`
const EconomicsFields=styled(Fields)`grid-template-columns:repeat(3,minmax(0,1fr));@media(max-width:800px){grid-template-columns:minmax(0,1fr)}`
const Checkbox=styled.label`display:flex;align-items:flex-start;gap:12px;font-size:14px;line-height:1.5;cursor:pointer;input{margin-top:4px;width:18px;height:18px;flex-shrink:0;accent-color:#a77ddb}small{display:block;margin-top:6px;font-size:12px;color:${p=>p.theme.colors.text.tertiary}}`
const Preview=styled.dl`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;padding:20px;background:#121016;border:1px solid ${p=>p.theme.colors.border.base};border-radius:var(--radius-md);margin:0;dt{font-size:11px;color:${p=>p.theme.colors.text.tertiary};margin-bottom:7px}dd{font-size:14px;margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}@media(max-width:650px){grid-template-columns:minmax(0,1fr)}`
const Submit=styled(PrimaryAction)`width:auto;min-width:180px;`
