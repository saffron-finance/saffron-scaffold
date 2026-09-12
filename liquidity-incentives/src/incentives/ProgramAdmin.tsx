import { useEffect,useState,type FormEvent } from 'react'
import { formatUnits,type Address } from 'viem'
import styled from 'styled-components'
import { requestFeeFromEth } from '../../shared/incentives.mjs'
import { campaignTerms } from '../../shared/campaign.mjs'
import { authedJson } from '../host/transport'
import { usd,type Pair,type Budget,type Program } from './model'
import { Action,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

type Catalog={pairs:Pair[];budgets:Budget[];programs:Program[]}

/** Campaign configuration owns advisory targets and immutable premium rates.
 * A single API transaction creates the budget and its matching offer together.
 */
export function ProgramAdmin({account,onConnect,autoLoad=false}:{account:Address|null;onConnect:()=>void;autoLoad?:boolean}){
  const [catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [showPair,setShowPair]=useState(false),[saved,setSaved]=useState('')
  async function load(){if(!account){onConnect();return}setBusy(true);setError('');try{setCatalog(await authedJson(account,'/admin/catalog'))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  // Dedicated campaign pages can load immediately; the operator disclosure keeps its manual default.
  useEffect(()=>{if(autoLoad&&account)void load()},[autoLoad,account])
  async function changed(){await load();setSaved('Campaign configuration saved.');window.dispatchEvent(new Event('saffron:catalog-updated'))}
  async function pause(budget:Budget){if(!account)return;setBusy(true);try{await authedJson(account,'/admin/budgets',{...budget,paused:!budget.paused});await changed()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Stack>
    <FinePrint>Campaign targets are private planning estimates, not request limits. Premium funding is handled externally.</FinePrint>
    <QuietButton disabled={busy} onClick={()=>void load()}>{catalog?'Reload campaigns':'Load incentive catalog'}</QuietButton>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}{saved&&<FinePrint role='status'>{saved}</FinePrint>}
    {catalog&&account&&<>
      {catalog.budgets.map(b=><Card key={b.id}><Row><b>{b.name}</b><QuietButton disabled={busy} onClick={()=>void pause(b)}>{b.paused?'Resume campaign':'Pause campaign'}</QuietButton></Row>
        {b.campaign&&b.accounting?<>
          <FinePrint>{b.campaign.days} days · {Number(b.campaign.aprPercent).toLocaleString('en-US',{maximumFractionDigits:4})}% APR · {usd(Number(b.campaign.capacityCents)/100)} target fixed-side capacity</FinePrint>
          <Stats><div>Budget<Strong>{usd(Number(b.accounting.budgetCents)/100)}</Strong></div><div>Premium funded<Strong>{usd(Number(b.accounting.fundedBudgetCents)/100)}</Strong></div><div>Budget reserved<Strong>{usd(Number(b.accounting.reservedBudgetCents)/100)}</Strong></div><div>Capacity funded<Strong>{usd(Number(b.accounting.fundedCapacityCents)/100)}</Strong></div><div>Target difference<Strong>{usd(Number(b.accounting.availableCapacityCents)/100)}</Strong></div></Stats>
          <FinePrint>LP deposits observed: {usd(Number(b.accounting.fixedDepositedCents)/100)} at request-time valuations. Premium funding and LP entry are tracked separately.</FinePrint>
        </>:<FinePrint>Token allocation: {formatUnits(BigInt(b.limitRaw),b.decimals)} · reserved {formatUnits(BigInt(b.reservedRaw),b.decimals)} · funded {formatUnits(BigInt(b.allocatedRaw),b.decimals)}.</FinePrint>}
        {b.campaign&&<AdvisoryTarget account={account} budget={b} onSaved={changed}/>}
        {b.reconciliationRequired&&<ErrorText>Accounting reconciliation is required; new requests are paused.</ErrorText>}
      </Card>)}
      {catalog.programs.map(program=><RequestFeeEditor key={program.id+':'+program.revision} account={account} program={program} onSaved={changed}/>)}
      <CampaignEditor account={account} pairs={catalog.pairs} onSaved={changed}/>
      <Row><b>Pairs</b><QuietButton onClick={()=>setShowPair(!showPair)}>{showPair?'Close pair form':'Add pair'}</QuietButton></Row>
      {catalog.pairs.map(pair=><FinePrint key={pair.id}>{pair.token0.symbol} / {pair.token1.symbol} · {pair.pool}</FinePrint>)}
      {showPair&&<PairEditor account={account} onSaved={async()=>{setShowPair(false);await changed()}}/>}
    </>}
  </Stack>
}

/** The chosen computed field is read-only; rounding displayed APR cannot alter
 * the server's exact budget/capacity ratio. Duration is always an explicit input.
 */
function CampaignEditor({account,pairs,onSaved}:{account:Address;pairs:Pair[];onSaved:()=>Promise<void>}){
  const [id,setId]=useState(''),[name,setName]=useState(''),[pairId,setPairId]=useState(pairs[0]?.id??'')
  const [days,setDays]=useState('3'),[budget,setBudget]=useState('10000'),[capacity,setCapacity]=useState('1000000'),[apr,setApr]=useState('121.66666667')
  const [computed,setComputed]=useState('apr'),[active,setActive]=useState(false),[requestFee,setRequestFee]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const economics={days:Number(days),...(computed!=='budget'?{budgetUsd:budget}:{}),...(computed!=='capacity'?{capacityUsd:capacity}:{}),...(computed!=='apr'?{aprPercent:apr}:{})}
  let terms:any=null,validation=''
  try{terms=campaignTerms(economics)}catch(e){validation=(e as Error).message}
  async function submit(event:FormEvent){event.preventDefault();if(!terms)return;setBusy(true);setError('')
    try{await authedJson(account,'/admin/campaigns',{id,name,pairId,active,requestFeeWei:requestFeeFromEth(requestFee),...economics});setId('');setName('');await onSaved()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Editor onSubmit={submit} aria-label='Create campaign'><b>Create campaign</b><Fields>
    <Field>Campaign ID<input aria-label='Campaign ID' required pattern={'[a-z0-9][a-z0-9\\-]{0,79}'} value={id} onChange={e=>setId(e.target.value)}/></Field>
    <Field>Campaign name<input aria-label='Campaign name' required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field>Pair<select aria-label='Campaign pair' required value={pairId} onChange={e=>setPairId(e.target.value)}><option value='' disabled>Select pair</option>{pairs.map(p=><option key={p.id} value={p.id}>{p.token0.symbol} / {p.token1.symbol}</option>)}</select></Field>
    <Field>Request fee (ETH)<input aria-label='Campaign request fee ETH' required inputMode='decimal' placeholder='Enter a fixed ETH amount' value={requestFee} onChange={e=>setRequestFee(e.target.value)}/></Field>
    <Field>Duration (days)<input aria-label='Campaign duration' required type='number' min={1} max={3650} step={1} value={days} onChange={e=>setDays(e.target.value)}/></Field>
    <Field>Calculate<select aria-label='Calculate campaign field' value={computed} onChange={e=>setComputed(e.target.value)}><option value='apr'>APR from budget + capacity</option><option value='capacity'>Capacity from budget + APR</option><option value='budget'>Budget from capacity + APR</option></select></Field>
    <Field>Budget (USD)<input aria-label='Campaign budget USD' inputMode='decimal' readOnly={computed==='budget'} value={computed==='budget'?(terms?formatUnits(BigInt(terms.budgetCents),2):''):budget} onChange={e=>setBudget(e.target.value)}/></Field>
    <Field>Target fixed-side capacity (USD)<input aria-label='Campaign capacity USD' inputMode='decimal' readOnly={computed==='capacity'} value={computed==='capacity'?(terms?formatUnits(BigInt(terms.capacityCents),2):''):capacity} onChange={e=>setCapacity(e.target.value)}/></Field>
    <Field>Target APR (%)<input aria-label='Campaign APR percent' inputMode='decimal' readOnly={computed==='apr'} value={computed==='apr'?(terms?Number(terms.aprPercent).toFixed(6):''):apr} onChange={e=>setApr(e.target.value)}/></Field>
  </Fields>
    <FinePrint>Enter a fixed ETH request fee, duration, and any two economics inputs. The fee is not linked to a dollar price. APR uses a 365-day year, without compounding. Targets do not restrict request count or size. The premium rate stays fixed after quoting; the internal planning budget can change independently.</FinePrint>
    <label><input type='checkbox' checked={active} onChange={e=>setActive(e.target.checked)}/> Accept paid vault requests when this campaign is created</label>
    {validation&&<FinePrint>{validation}</FinePrint>}{error&&<ErrorText role='alert'>{error}</ErrorText>}
    <Action disabled={busy||!terms||!pairId}>{busy?'Saving campaign…':'Create campaign'}</Action>
  </Editor>
}

/** Fee revisions affect only new quotes. A stored payment/refund keeps its exact
 * original wei amount; operators must not reprice an in-flight request. */
function RequestFeeEditor({account,program,onSaved}:{account:Address;program:Program;onSaved:()=>Promise<void>}){
  const [value,setValue]=useState(program.requestFeeWei?formatUnits(BigInt(program.requestFeeWei),18):'')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{await authedJson(account,'/admin/programs',{...program,requestFeeWei:requestFeeFromEth(value)});await onSaved()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Editor onSubmit={save} aria-label={'Request fee for '+program.id}><b>{program.id} · Request fee</b>
    <Field>Fixed request fee (ETH)<input required aria-label={'Request fee ETH for '+program.id} inputMode='decimal' value={value} onChange={e=>setValue(e.target.value)}/></Field>
    <FinePrint>Each new request costs this ETH amount plus wallet network gas. Previously issued payment terms and refunds do not change.</FinePrint>
    {error&&<ErrorText role='alert'>{error}</ErrorText>}<Action disabled={busy}>Save request fee</Action>
  </Editor>
}

/** Editing a planning target must not alter the campaign's quoted economics. */
function AdvisoryTarget({account,budget,onSaved}:{account:Address;budget:Budget;onSaved:()=>Promise<void>}){
  const [value,setValue]=useState(String(Number(budget.advisoryBudgetCents??budget.campaign.budgetCents)/100)),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(){setBusy(true);setError('');try{await authedJson(account,'/admin/budgets/'+budget.id+'/advisory',{revision:budget.revision,budgetUsd:value});await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <><label>Internal planning budget (USD)<input aria-label={'Planning budget for '+budget.name} value={value} onChange={e=>setValue(e.target.value)} inputMode='decimal'/></label>
    <QuietButton disabled={busy} onClick={()=>void save()}>Update planning target</QuietButton>{error&&<ErrorText role='alert'>{error}</ErrorText>}</>
}

/** Pool metadata is verified against the chain by the API before it is saved. */
function PairEditor({account,onSaved}:{account:Address;onSaved:()=>Promise<void>}){
  const [body,setBody]=useState({id:'',revision:0,chainId:4663,pool:'',feeTier:10000,active:true,token0:{address:'',symbol:'',decimals:18},token1:{address:'',symbol:'',decimals:18}})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);try{await authedJson(account,'/admin/pairs',body);await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Editor onSubmit={submit}><b>Add pair</b><Fields>
    <Field>Pair ID<input required value={body.id} onChange={e=>setBody({...body,id:e.target.value})}/></Field>
    <Field>Pool address<input required value={body.pool} onChange={e=>setBody({...body,pool:e.target.value})}/></Field>
    <Field>Fee tier<select value={body.feeTier} onChange={e=>setBody({...body,feeTier:Number(e.target.value)})}>{[100,500,3000,10000].map(f=><option key={f} value={f}>{f/10000}%</option>)}</select></Field>
    {(['token0','token1'] as const).map((key,i)=><div key={key}><b>{i===0?'Reward token':'Quote token'}</b>{(['address','symbol','decimals'] as const).map(field=><Field key={field}>{field}<input required value={body[key][field]} onChange={e=>setBody({...body,[key]:{...body[key],[field]:field==='decimals'?Number(e.target.value):e.target.value}})}/></Field>)}</div>)}
  </Fields>{error&&<ErrorText role='alert'>{error}</ErrorText>}<Action disabled={busy}>Save pair</Action></Editor>
}
const Card=styled.div`display:flex;flex-direction:column;gap:20px;padding:28px 32px;background:#0a0a0a;border:1px solid #1d1d1d;border-radius:var(--radius-md);>div:first-child{flex-wrap:wrap}b{font-family:${p=>p.theme.fonts.display};font-size:22px;font-weight:400}@media(max-width:650px){padding:24px 16px}`
const Editor=styled(Card).attrs({as:'form'})`gap:24px;>label{font-size:13px;color:${p=>p.theme.colors.text.secondary}}`
const Fields=styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;@media(max-width:650px){grid-template-columns:minmax(0,1fr)}`
const Field=styled.label`display:flex;flex-direction:column;gap:8px;min-width:0;color:${p=>p.theme.colors.text.tertiary};font:400 11px ${p=>p.theme.fonts.mono};input,select{width:100%;min-width:0;background:#0a0a0a;color:${p=>p.theme.colors.text.primary};border:1px solid ${p=>p.theme.colors.border.base};border-radius:var(--radius-md);padding:12px;font:400 14px ${p=>p.theme.fonts.body}}input:focus-visible,select:focus-visible{outline:1px solid ${p=>p.theme.colors.accent.gold}}input:read-only{color:${p=>p.theme.colors.accent.gold}}`
const Stats=styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;font-size:12px;`
const Strong=styled.b`display:block;margin-top:5px;font-size:18px;`
