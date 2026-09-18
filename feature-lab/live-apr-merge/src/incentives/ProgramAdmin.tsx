import { useEffect,useState,type FormEvent } from 'react'
import { formatUnits,type Address } from 'viem'
import styled from 'styled-components'
import { ConfigurationWarnings } from './ConfigurationWarnings'
import { CampaignDeployerBalance } from './DeployerBalance'
import { PairEditor } from './PairEditor'
import { CampaignIdentifier } from './CampaignIdentifier'
import { requestFeeFromEth } from '../../shared/incentives.mjs'
import { authedJson } from '../host/transport'
import { usd,type Budget,type Program } from './model'
import { ErrorText,FinePrint,PrimaryAction,QuietButton,Row,Stack } from './styles'
import { Field,InlineForm,Panel,SaveButton,SectionIntro,poolHeading,useCampaignCatalog } from './campaign-admin'

/** One configuration row per persisted program. Funding is listed once per
 * budget below, because historical programs can share the same allocation. */
export function ProgramAdmin({account,onConnect,onCreate,autoLoad=false}:{account:Address|null;onConnect:()=>void;onCreate:()=>void;autoLoad?:boolean}){
  const {catalog,busy,error,load}=useCampaignCatalog(account,onConnect,autoLoad)
  const [showPair,setShowPair]=useState(false),[saved,setSaved]=useState(''),[actionError,setActionError]=useState(''),[pausing,setPausing]=useState(false)
  async function changed(){
    const refreshed=await load()
    setSaved(refreshed?'Campaign configuration saved.':'Configuration saved. Reload the catalog to see the latest settings.')
    window.dispatchEvent(new Event('saffron:catalog-updated'))
  }
  async function pause(budget:Budget){
    if(!account||pausing)return
    setPausing(true);setActionError('');setSaved('')
    try{await authedJson(account,'/admin/budgets',{...budget,paused:!budget.paused});await changed()}
    catch(e){setActionError((e as Error).message)}finally{setPausing(false)}
  }
  const linked=(id:string)=>catalog?.programs.filter(program=>program.budgetPoolId===id)??[]
  return <Stack>
    <Row><SectionIntro><FinePrint>Manage existing programs, review funding, and maintain supported pairs.</FinePrint><FinePrint>Planning targets are estimates, not request limits. Program settings do not override shared request intake.</FinePrint></SectionIntro><NewButton onClick={onCreate}>New campaign</NewButton></Row>
    <Panel aria-label='Program configuration'>
      <Row><SectionIntro><h2>Program configuration</h2><FinePrint>{catalog?`${catalog.programs.length} program${catalog.programs.length===1?'':'s'} · ${catalog.pairs.length} pair${catalog.pairs.length===1?'':'s'}`:'Sign in with an operator wallet to view campaign settings.'}</FinePrint></SectionIntro><SaveButton disabled={busy||pausing} onClick={()=>{setSaved('');void load()}}>{busy?'Loading campaigns…':catalog?'Reload campaigns':'Load incentive catalog'}</SaveButton></Row>
      {error&&<ErrorText role='alert'>{error} Reload before editing settings.</ErrorText>}{actionError&&<ErrorText role='alert'>{actionError}</ErrorText>}{saved&&<FinePrint role='status'>{saved}</FinePrint>}
      {catalog&&account&&<EditScope disabled={busy||pausing||!!error} aria-label='Campaign settings'>
        {catalog.programs.length===0?<Empty>No programs yet. Use New campaign to configure one.</Empty>:<Table aria-label='Campaign configuration'>
          <thead><tr><th scope='col'>Program</th><th scope='col'>Fixed terms</th><th scope='col'>Planning budget</th><th scope='col'>Request fee</th><th scope='col'>Controls</th></tr></thead>
          <tbody>{catalog.programs.map(program=>{
            const budget=catalog.budgets.find(b=>b.id===program.budgetPoolId),shared=linked(program.budgetPoolId).length>1
            const status=!budget?'Budget unavailable':budget.reconciliationRequired?'Reconciliation':budget.paused?'Paused':program.active?'Enabled':'Disabled'
            return <tr key={program.id} data-program-id={program.id} data-budget-id={program.budgetPoolId}>
              <td data-label='Program'><Cell><ProgramName>{poolHeading(catalog.pairs.find(p=>p.id===program.pairId))}</ProgramName><CampaignIdentifier id={program.id}/><Status $enabled={status==='Enabled'}>{status}</Status>{shared&&<FinePrint>Shared budget · {linked(program.budgetPoolId).length} programs</FinePrint>}</Cell></td>
              <td data-label='Fixed terms'><Cell><Metric>{program.days} days</Metric><FinePrint>{Number.isFinite(Number(program.apr))?`${Number(program.apr).toLocaleString('en-US',{maximumFractionDigits:4})}% APR`:'APR unavailable'}</FinePrint><FinePrint>Infinite range</FinePrint>{budget?.campaign?.capacityCents&&<FinePrint>{usd(Number(budget.campaign.capacityCents)/100)} target fixed-side capacity</FinePrint>}</Cell></td>
              <td data-label='Planning budget'>{budget?.campaign?<AdvisoryTarget account={account} budget={budget} programId={program.id} onSaved={changed}/>:<FinePrint>{budget?'Legacy token allocation — see accounting below.':'Budget unavailable'}</FinePrint>}</td>
              <td data-label='Request fee'><RequestFeeEditor account={account} program={program} onSaved={changed}/></td>
              <td data-label='Controls'><Cell>{budget&&<SaveButton onClick={()=>void pause(budget)}>{budget.paused?'Resume campaign':'Pause campaign'}</SaveButton>}{shared&&<FinePrint>Pause / resume affects all programs sharing this budget.</FinePrint>}{budget?.reconciliationRequired&&<ErrorText>Reconcile accounting before accepting requests.</ErrorText>}{!program.active&&<FinePrint>This program is disabled. Resuming its budget does not enable it.</FinePrint>}</Cell></td>
            </tr>
          })}</tbody>
        </Table>}
        <Footnotes><FinePrint>Planning budget edits do not change quoted APR or capacity.</FinePrint><FinePrint>Request fee is a fixed ETH amount for new quotes, plus wallet network gas. Existing payments and refunds keep their original terms.</FinePrint></Footnotes>
      </EditScope>}
    </Panel>
    {autoLoad&&<DisclosurePanel><summary><h2>Shared service status</h2><FinePrint>Deployer gas and application configuration · independent of program settings</FinePrint></summary><DisclosureBody><CampaignDeployerBalance account={account}/><ConfigurationWarnings compact account={account}/></DisclosureBody></DisclosurePanel>}
    {catalog&&account&&<>
      <DisclosurePanel><summary><h2>Funding &amp; accounting</h2><FinePrint>{catalog.budgets.length} budgets · external premium funding and observed LP deposits</FinePrint></summary><DisclosureBody>
        <FinePrint>Each budget appears once, including budgets shared by multiple programs. Planning differences are not spendable balances or request limits.</FinePrint>
        <EditScope disabled={busy||pausing||!!error} aria-label='Budget accounting'>
          {!catalog.budgets.length?<Empty>No budget records yet.</Empty>:catalog.budgets.map(b=>{
            const programs=linked(b.id)
            return <BudgetCard key={b.id} data-accounting-budget-id={b.id}>
              <Row><SectionIntro><h3>{b.name||'Campaign budget'}</h3><FinePrint>Budget ID: {b.id} · {programs.length?`${programs.length} linked program${programs.length===1?'':'s'}`:'No campaign linked'}</FinePrint></SectionIntro><Status $enabled={!b.paused&&!b.reconciliationRequired}>{b.reconciliationRequired?'Reconciliation':b.paused?'Paused':'Unpaused'}</Status></Row>
              {b.campaign&&b.accounting?<Stats>
                {([['Planning budget',b.accounting.budgetCents],['Premium funded',b.accounting.fundedBudgetCents],['Budget reserved',b.accounting.reservedBudgetCents],['Capacity funded',b.accounting.fundedCapacityCents],['Target difference',b.accounting.availableCapacityCents],['LP deposits observed',b.accounting.fixedDepositedCents]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value==null?'Unavailable':usd(Number(value)/100)}</dd></div>)}
              </Stats>:<FinePrint>Token allocation: {formatUnits(BigInt(b.limitRaw),b.decimals)} · reserved {formatUnits(BigInt(b.reservedRaw),b.decimals)} · funded {formatUnits(BigInt(b.allocatedRaw),b.decimals)}.</FinePrint>}
              <FinePrint>LP deposits use request-time valuations. Premium funding and LP entry are tracked separately.</FinePrint>
              {/* Orphaned historical budgets stay manageable without inventing a program. */}
              {!programs.length&&<><SaveButton onClick={()=>void pause(b)}>{b.paused?'Resume budget':'Pause budget'}</SaveButton>{b.campaign&&<AdvisoryTarget account={account} budget={b} onSaved={changed}/>}</>}
              {b.reconciliationRequired&&<ErrorText>Accounting reconciliation is required; new requests are paused.</ErrorText>}
            </BudgetCard>
          })}
        </EditScope>
      </DisclosureBody></DisclosurePanel>
      <DisclosurePanel><summary><h2>Pair management</h2><FinePrint>{catalog.pairs.length} configured pairs · pool addresses and availability</FinePrint></summary><DisclosureBody>
        <Row><FinePrint>Choose from these pairs when creating a campaign.</FinePrint><SaveButton aria-expanded={showPair} onClick={()=>setShowPair(!showPair)}>{showPair?'Close pair form':'Add pair'}</SaveButton></Row>
        {!catalog.pairs.length?<Empty>No supported pairs yet. Add a pair before creating a campaign.</Empty>:<PairList>{catalog.pairs.map(pair=><li key={pair.id}><div><ProgramName>{poolHeading(pair)}</ProgramName><FinePrint>{pair.active?'Enabled':'Disabled'} · Chain {pair.chainId}</FinePrint></div><code>{pair.pool}</code></li>)}</PairList>}
        {showPair&&<PairEditor key={account} account={account} pairs={catalog.pairs} onSaved={async()=>{setShowPair(false);await changed()}}/>}
      </DisclosureBody></DisclosurePanel>
    </>}
  </Stack>
}

/** Keep exact wei in transit and bind a dirty draft to its original revision.
 * Reloading must not silently overwrite a fee or bless an old edit as current. */
function RequestFeeEditor({account,program,onSaved}:{account:Address;program:Program;onSaved:()=>Promise<void>}){
  const amount=program.requestFeeWei==null?'':formatUnits(BigInt(program.requestFeeWei),18)
  const [draft,setDraft]=useState({value:amount,revision:program.revision,dirty:false})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{setDraft(old=>old.dirty?old:{value:amount,revision:program.revision,dirty:false})},[amount,program.revision])
  const conflict=draft.dirty&&draft.revision!==program.revision
  async function save(event:FormEvent){
    event.preventDefault();if(conflict||busy)return
    setBusy(true);setError('')
    try{await authedJson(account,'/admin/programs',{...program,revision:draft.revision,requestFeeWei:requestFeeFromEth(draft.value)});setDraft(old=>({...old,dirty:false}));await onSaved()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <InlineForm onSubmit={save} aria-label={'Request fee for '+program.id}>
    <Field>Fixed fee · ETH<input required aria-label={'Request fee ETH for '+program.id} inputMode='decimal' placeholder='e.g. 0.001' value={draft.value} onChange={e=>setDraft(old=>({...old,value:e.target.value,dirty:true}))}/></Field>
    {conflict&&<ErrorText role='alert'>The program changed elsewhere. <QuietButton type='button' onClick={()=>{setDraft({value:amount,revision:program.revision,dirty:false});setError('')}}>Use latest fee</QuietButton></ErrorText>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}<SaveButton disabled={busy||conflict||!draft.dirty}>{busy?'Saving fee…':'Save request fee'}</SaveButton>
  </InlineForm>
}

/** Planning targets are advisory only. Independent optimistic revisions also
 * protect shared-budget edits and preserve dirty drafts across catalog reloads. */
function AdvisoryTarget({account,budget,programId,onSaved}:{account:Address;budget:Budget;programId?:string;onSaved:()=>Promise<void>}){
  const amount=formatUnits(BigInt(budget.advisoryBudgetCents??budget.campaign.budgetCents),2)
  const [draft,setDraft]=useState({value:amount,revision:budget.revision,dirty:false})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{setDraft(old=>old.dirty?old:{value:amount,revision:budget.revision,dirty:false})},[amount,budget.revision])
  const conflict=draft.dirty&&draft.revision!==budget.revision
  async function save(event:FormEvent){
    event.preventDefault();if(conflict||busy)return
    setBusy(true);setError('')
    try{await authedJson(account,'/admin/budgets/'+budget.id+'/advisory',{revision:draft.revision,budgetUsd:draft.value});setDraft(old=>({...old,dirty:false}));await onSaved()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <InlineForm onSubmit={save} aria-label={'Planning target for '+(programId??budget.id)}>
    <Field>Advisory target · USD<input required aria-label={'Planning budget for '+(programId??budget.name)} value={draft.value} onChange={e=>setDraft(old=>({...old,value:e.target.value,dirty:true}))} inputMode='decimal'/></Field>
    {conflict&&<ErrorText role='alert'>The planning target changed elsewhere. <QuietButton type='button' onClick={()=>{setDraft({value:amount,revision:budget.revision,dirty:false});setError('')}}>Use latest target</QuietButton></ErrorText>}
    <SaveButton disabled={busy||conflict}>{busy?'Saving target…':'Update planning target'}</SaveButton>{error&&<ErrorText role='alert'>{error}</ErrorText>}
  </InlineForm>
}

const NewButton=styled(PrimaryAction)`width:auto;min-width:150px;`
const EditScope=styled.fieldset`border:0;padding:0;margin:0;min-width:0;`
const Table=styled.table`
  width:100%;border-collapse:collapse;table-layout:fixed;text-align:left;font-size:13px;
  th{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:${p=>p.theme.colors.text.tertiary};padding:0 12px 14px}
  th:first-child{width:26%}th:nth-child(2){width:17%}th:nth-child(3),th:nth-child(4){width:20%}
  td{padding:22px 12px;vertical-align:top;border-top:1px solid ${p=>p.theme.colors.border.base};overflow-wrap:anywhere}
  tbody tr:hover{background:rgba(180,145,219,.025)}
  @media(max-width:1250px){
    &,tbody,tr,td{display:block;width:auto}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    tbody{display:grid;gap:18px}tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid ${p=>p.theme.colors.border.base};border-radius:var(--radius-md);padding:18px;gap:22px}
    td{border:0;padding:0}td:first-child{grid-column:1/-1}td::before{content:attr(data-label);display:block;margin-bottom:12px;font-size:11px;color:${p=>p.theme.colors.text.tertiary};text-transform:uppercase;letter-spacing:.04em}
  }
  @media(max-width:650px){tr{grid-template-columns:minmax(0,1fr);padding:16px}td:first-child{grid-column:auto}}
`
const Cell=styled.div`display:flex;flex-direction:column;gap:10px;min-width:0;`
const ProgramName=styled.strong`font-size:15px;font-weight:500;line-height:1.5;`
const Metric=styled.strong`font-weight:500;font-variant-numeric:tabular-nums;`
const Status=styled.span<{$enabled:boolean}>`align-self:flex-start;display:inline-flex;width:fit-content;padding:4px 8px;border:1px solid ${p=>p.$enabled?'#315b48':'#514856'};border-radius:6px;color:${p=>p.$enabled?'#a0dbb8':'#c6bdce'};font-size:11px;`
const Footnotes=styled.div`display:flex;flex-direction:column;gap:6px;border-top:1px solid ${p=>p.theme.colors.border.base};padding-top:18px;margin-top:4px;`
const Empty=styled.p`padding:18px 0;font-size:14px;color:${p=>p.theme.colors.text.secondary};`
const DisclosurePanel=styled(Panel).attrs({as:'details'})`display:block;summary{cursor:pointer;list-style-position:outside;margin-left:16px;padding-left:4px}summary h2{display:inline;font-size:22px}summary p{margin-top:8px}summary:focus-visible{outline:2px solid ${p=>p.theme.colors.accent.gold};outline-offset:6px}`
const DisclosureBody=styled.div`display:flex;flex-direction:column;gap:20px;margin-top:24px;`
const BudgetCard=styled.div`padding:20px 0;border-top:1px solid ${p=>p.theme.colors.border.base};display:flex;flex-direction:column;gap:18px;`
const Stats=styled.dl`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin:0;dt{font-size:12px;color:${p=>p.theme.colors.text.tertiary};margin-bottom:8px}dd{margin:0;font-size:18px;font-variant-numeric:tabular-nums}@media(max-width:650px){grid-template-columns:repeat(2,minmax(0,1fr))}`
const PairList=styled.ul`list-style:none;padding:0;margin:0;li{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:18px 0;border-top:1px solid ${p=>p.theme.colors.border.base}}code{font-size:12px;overflow-wrap:anywhere;color:${p=>p.theme.colors.text.secondary}}`
