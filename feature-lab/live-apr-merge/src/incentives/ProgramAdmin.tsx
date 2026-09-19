import {useEffect,useState,type FormEvent} from 'react'
import {formatUnits,type Address} from 'viem'
import styled from 'styled-components'
import {ConfigurationWarnings} from './ConfigurationWarnings'
import {ProgramDeployerBalance} from './DeployerBalance'
import {PairEditor} from './PairEditor'
import {FundingAccounting} from './FundingAccounting'
import {ProgramIdentifier} from './ProgramIdentifier'
import {programReference,programText} from './program-language'
import {requestFeeFromEth} from '../../shared/incentives.mjs'
import {authedJson} from '../host/transport'
import {usd,type Budget,type Program} from './model'
import {ErrorText,FinePrint,PrimaryAction,QuietButton,Row,Stack} from './styles'
import {Field,InlineForm,Panel,SaveButton,SectionIntro,poolHeading,useProgramCatalog} from './program-admin'

/** Program directory and one selected program, matching the server console's
 * search/card/detail hierarchy. Selection is read-only and uses a shareable
 * display reference; every mutation still sends the untouched catalog record. */
export function ProgramAdmin({account,onConnect,onCreate,autoLoad=false}:{account:Address|null;onConnect:()=>void;onCreate:()=>void;autoLoad?:boolean}){
  const {catalog,busy,error,load}=useProgramCatalog(account,onConnect,autoLoad)
  const [showPair,setShowPair]=useState(false),[saved,setSaved]=useState(''),[actionError,setActionError]=useState(''),[pausing,setPausing]=useState(false),[search,setSearch]=useState('')
  const [selectedRef,setSelectedRef]=useState(readSelection)
  useEffect(()=>{const update=()=>setSelectedRef(readSelection());window.addEventListener('hashchange',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('popstate',update)}},[])
  function select(id:string|null){setSelectedRef(id?programReference(id):null);location.hash=id?'program/'+encodeURIComponent(programReference(id)):'programs'}
  async function changed(){
    const refreshed=await load()
    setSaved(refreshed?'Incentive program configuration saved.':'Configuration saved. Reload the catalog to see the latest settings.')
    window.dispatchEvent(new Event('saffron:catalog-updated'))
  }
  async function pause(budget:Budget){
    if(!account||pausing)return
    setPausing(true);setActionError('');setSaved('')
    try{await authedJson(account,'/admin/budgets',{...budget,paused:!budget.paused});await changed()}
    catch(e){setActionError(programText((e as Error).message))}finally{setPausing(false)}
  }
  const linked=(id:string)=>catalog?.programs.filter(program=>program.budgetPoolId===id)??[]
  const selected=catalog?.programs.find(p=>p.id===selectedRef||programReference(p.id)===selectedRef)
  const filter=search.trim().toLowerCase()
  const filtered=catalog?.programs.filter(p=>`${poolHeading(catalog.pairs.find(pair=>pair.id===p.pairId))} ${p.days} days ${p.id} ${programReference(p.id)}`.toLowerCase().includes(filter))??[]
  const budgets=selectedRef?catalog?.budgets.filter(b=>b.id===selected?.budgetPoolId)??[]:catalog?.budgets??[]
  /** Configuration status is not a claim that shared services or funding are
   * ready. Server-wide launch checks remain in the separate operator console. */
  function state(program:Program){const b=catalog?.budgets.find(b=>b.id===program.budgetPoolId);return error?'Unavailable':!b?'Budget unavailable':b.reconciliationRequired?'Needs attention':b.paused?'Paused':!program.active?'Disabled':'Enabled'}
  function settings(program:Program){
    if(!account)return null
    const budget=catalog?.budgets.find(b=>b.id===program.budgetPoolId),shared=linked(program.budgetPoolId).length>1
    return <SettingsGrid>
      <SettingsSection><h3>Planning budget</h3>{budget?.campaign?<AdvisoryTarget key={budget.id} account={account} budget={budget} programId={program.id} onSaved={changed}/>:<FinePrint>{budget?'Legacy token allocation — see accounting below.':'Budget unavailable'}</FinePrint>}{budget?.campaign?.capacityCents&&<FinePrint>{usd(Number(budget.campaign.capacityCents)/100)} original fixed-side capacity target</FinePrint>}</SettingsSection>
      <SettingsSection><h3>Request fee</h3><RequestFeeEditor key={program.id} account={account} program={program} onSaved={changed}/></SettingsSection>
      <SettingsSection><h3>Program controls</h3>{budget&&<SaveButton onClick={()=>void pause(budget)}>{budget.paused?'Resume incentive program':'Pause incentive program'}</SaveButton>}{shared&&<FinePrint>Pause / resume affects all programs sharing this budget.</FinePrint>}{budget?.reconciliationRequired&&<ErrorText>Reconcile accounting before accepting requests.</ErrorText>}{!program.active&&<FinePrint>This program is disabled. Resuming its budget does not enable it.</FinePrint>}<FinePrint>Shared service checks and intake are managed separately in Server Admin.</FinePrint></SettingsSection>
    </SettingsGrid>
  }
  return <Stack>
    <Row><SectionIntro><FinePrint>Manage incentive programs, review funding, and maintain supported pairs.</FinePrint><FinePrint>Planning targets are estimates, not request limits. Program settings do not override shared request intake.</FinePrint></SectionIntro><NewButton onClick={onCreate}>New incentive program</NewButton></Row>
    <Panel aria-label='Program configuration'>
      <Row><SectionIntro><h2>{selectedRef?'Incentive program':'Incentive programs'}</h2><FinePrint>{catalog?`${catalog.programs.length} programs · including paused and disabled`:'Sign in with an operator wallet to view incentive program settings.'}</FinePrint></SectionIntro><SaveButton disabled={busy||pausing} onClick={()=>{setSaved('');void load()}}>{busy?'Loading incentive programs…':catalog?'Reload incentive programs':'Load incentive catalog'}</SaveButton></Row>
      {error&&<ErrorText role='alert'>{programText(error)} Reload before editing settings.</ErrorText>}{actionError&&<ErrorText role='alert'>{actionError}</ErrorText>}{saved&&<FinePrint role='status'>{saved}</FinePrint>}
      {catalog&&account&&<>
        {selectedRef?<>
          <BackButton aria-label="All incentive programs" onClick={()=>select(null)}>← All incentive programs</BackButton>
          {selected?<section aria-label='Incentive program details' data-program-detail={selected.id} data-program-id={selected.id} data-budget-id={selected.budgetPoolId}>
            <DetailHeader><Row><h3>{poolHeading(catalog.pairs.find(p=>p.id===selected.pairId))}</h3><Status $enabled={state(selected)==='Enabled'}>{state(selected)}</Status></Row><FinePrint>{selected.days} days · {selected.apr}% APR · Infinite range</FinePrint><ProgramIdentifier id={selected.id}/></DetailHeader>
            <EditScope disabled={busy||pausing||!!error} aria-label='Incentive program settings'>{settings(selected)}<Footnotes><FinePrint>Planning budget edits do not change quoted APR or capacity.</FinePrint><FinePrint>Request fee is a fixed ETH amount for new quotes, plus wallet network gas. Existing payments and refunds keep their original terms.</FinePrint></Footnotes></EditScope>
          </section>:<Empty>This incentive program is no longer in the current catalog.</Empty>}
        </>:<>
          <Toolbar><Field>Find a program<input type='search' aria-label='Find a program' placeholder='Pair, duration, or program ID' value={search} onChange={e=>setSearch(e.target.value)}/></Field><FinePrint role='status'>{filtered.length} of {catalog.programs.length} programs · including paused and disabled</FinePrint></Toolbar>
          {!catalog.programs.length?<Empty>No incentive programs yet. Use New incentive program to configure one.</Empty>:<><ProgramCards aria-label='Incentive programs'>{filtered.map(program=>{
            const label=state(program),fee=program.requestFeeWei==null?'Not configured':formatUnits(BigInt(program.requestFeeWei),18)+' ETH'
            return <li key={program.id} data-program-id={program.id} data-budget-id={program.budgetPoolId}><ProgramCard type='button' aria-label={'Open incentive program '+programReference(program.id)} onClick={()=>select(program.id)}><Row><ProgramName>{poolHeading(catalog.pairs.find(p=>p.id===program.pairId))}</ProgramName><Status $enabled={label==='Enabled'}>{label}</Status></Row><FinePrint>{program.days} days · {Number.isFinite(Number(program.apr))?Number(program.apr).toLocaleString('en-US',{maximumFractionDigits:4})+'% APR':'APR unavailable'} · {fee} fee</FinePrint><ProgramIdentifier id={program.id}/><FinePrint>Configuration, funding &amp; accounting{linked(program.budgetPoolId).length>1?' · Shared budget':''}</FinePrint><CardLink>Open this incentive program →</CardLink></ProgramCard></li>
          })}</ProgramCards>{!filtered.length&&<Empty>No incentive programs match this search.</Empty>}</>}
        </>}
      </>}
    </Panel>
    {autoLoad&&!selectedRef&&<DisclosurePanel><summary><h2>Shared service status</h2><FinePrint>Deployer gas and application configuration · independent of program settings</FinePrint></summary><DisclosureBody><ProgramDeployerBalance account={account}/><ConfigurationWarnings compact account={account}/></DisclosureBody></DisclosurePanel>}
    {catalog&&account&&<>
      {!!budgets.length&&<DisclosurePanel><summary><h2>Funding &amp; accounting</h2><FinePrint>{budgets.length} budgets · external premium funding and observed LP deposits</FinePrint></summary><DisclosureBody>
        <FinePrint>Each budget appears once, including budgets shared by multiple programs. Planning differences are not spendable balances or request limits.</FinePrint>
        <EditScope disabled={busy||pausing||!!error} aria-label='Budget accounting'>
          {budgets.map(b=>{
            const programs=linked(b.id)
            return <BudgetCard key={b.id} data-accounting-budget-id={b.id}>
              <Row><SectionIntro><h3>{programText(b.name||'Program budget')}</h3><FinePrint>Budget ID: {programReference(b.id)} · {programs.length?`${programs.length} linked program${programs.length===1?'':'s'}`:'No program linked'}</FinePrint></SectionIntro><Status $enabled={!b.paused&&!b.reconciliationRequired}>{b.reconciliationRequired?'Reconciliation':b.paused?'Paused':'Unpaused'}</Status></Row>
              <FundingAccounting budget={b}/>{!b.campaign&&<FinePrint>Legacy token allocation: {formatUnits(BigInt(b.limitRaw),b.decimals)} · reserved {formatUnits(BigInt(b.reservedRaw),b.decimals)} · funded {formatUnits(BigInt(b.allocatedRaw),b.decimals)}.</FinePrint>}
              {!programs.length&&<><SaveButton onClick={()=>void pause(b)}>{b.paused?'Resume budget':'Pause budget'}</SaveButton>{b.campaign&&<AdvisoryTarget account={account} budget={b} onSaved={changed}/>}</>}
              {b.reconciliationRequired&&<ErrorText>Accounting reconciliation is required; new requests are paused.</ErrorText>}
            </BudgetCard>
          })}
        </EditScope>
      </DisclosureBody></DisclosurePanel>}
      {!selectedRef&&<DisclosurePanel><summary><h2>Pair management</h2><FinePrint>{catalog.pairs.length} configured pairs · pool addresses and availability</FinePrint></summary><DisclosureBody>
        <Row><FinePrint>Choose from these pairs when creating an incentive program.</FinePrint><SaveButton aria-expanded={showPair} onClick={()=>setShowPair(!showPair)}>{showPair?'Close pair form':'Add pair'}</SaveButton></Row>
        {!catalog.pairs.length?<Empty>No supported pairs yet. Add a pair before creating an incentive program.</Empty>:<PairList>{catalog.pairs.map(pair=><li key={pair.id}><div><ProgramName>{poolHeading(pair)}</ProgramName><FinePrint>{pair.active?'Enabled':'Disabled'} · Chain {pair.chainId}</FinePrint></div><code>{pair.pool}</code></li>)}</PairList>}
        {showPair&&<PairEditor key={account} account={account} pairs={catalog.pairs} onSaved={async()=>{setShowPair(false);await changed()}}/>}
      </DisclosureBody></DisclosurePanel>}
    </>}
  </Stack>
}
/** Accept both historical raw-ID links and the current display reference. */
function readSelection(){try{return location.hash.startsWith('#program/')?decodeURIComponent(location.hash.slice(9)):null}catch{return ''}}

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
    catch(e){setError(programText((e as Error).message))}finally{setBusy(false)}
  }
  return <InlineForm onSubmit={save} aria-label={'Request fee for '+programReference(program.id)}>
    <Field>Fixed fee · ETH<input required aria-label={'Request fee ETH for '+programReference(program.id)} inputMode='decimal' placeholder='e.g. 0.001' value={draft.value} onChange={e=>setDraft(old=>({...old,value:e.target.value,dirty:true}))}/></Field>
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
    catch(e){setError(programText((e as Error).message))}finally{setBusy(false)}
  }
  return <InlineForm onSubmit={save} aria-label={'Planning target for '+programReference(programId??budget.id)}>
    <Field>Advisory target · USD<input required aria-label={'Planning budget for '+(programId?programReference(programId):programText(budget.name))} value={draft.value} onChange={e=>setDraft(old=>({...old,value:e.target.value,dirty:true}))} inputMode='decimal'/></Field>
    {conflict&&<ErrorText role='alert'>The planning target changed elsewhere. <QuietButton type='button' onClick={()=>{setDraft({value:amount,revision:budget.revision,dirty:false});setError('')}}>Use latest target</QuietButton></ErrorText>}
    <SaveButton disabled={busy||conflict}>{busy?'Saving target…':'Update planning target'}</SaveButton>{error&&<ErrorText role='alert'>{error}</ErrorText>}
  </InlineForm>
}

const NewButton=styled(PrimaryAction)`width:auto;min-width:150px;`
const EditScope=styled.fieldset`border:0;padding:0;margin:0;min-width:0;`
const Toolbar=styled.div`display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:2px 0;>label{flex:1;max-width:490px}>p{font-size:11px;text-align:right}@media(max-width:760px){flex-direction:column;align-items:stretch;>label{max-width:none}>p{text-align:left}}`
const ProgramCards=styled.ul`list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;>li{min-width:0}@media(max-width:760px){grid-template-columns:minmax(0,1fr)}`
const ProgramCard=styled.button`width:100%;height:100%;min-width:0;padding:24px;display:flex;flex-direction:column;gap:14px;text-align:left;color:inherit;font:inherit;cursor:pointer;background:#0a090b;border:1px solid #302a34;border-radius:8px;>div:first-child{justify-content:space-between;flex-wrap:wrap;align-items:flex-start;gap:12px}p{font-size:12px}code{overflow-wrap:anywhere}&:hover{border-color:#b77ac9;background:#160e1b}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px}@media(max-width:760px){padding:20px}`
const CardLink=styled.span`margin-top:auto;color:#cf94df;font-size:12px;`
const BackButton=styled(QuietButton)`align-self:flex-start;color:#cf94df;padding-left:0;`
const DetailHeader=styled.div`display:flex;flex-direction:column;gap:12px;padding:4px 0 22px;h3{font-size:26px;line-height:1.35}code{overflow-wrap:anywhere}`
const SettingsGrid=styled.div`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:24px 0;border-top:1px solid #302a34;@media(max-width:1000px){grid-template-columns:minmax(0,1fr)}`
const SettingsSection=styled.section`display:flex;flex-direction:column;gap:14px;min-width:0;h3{font-size:18px}`
const ProgramName=styled.strong`font-size:20px;font-weight:400;line-height:1.5;`
const Status=styled.span<{$enabled:boolean}>`align-self:flex-start;display:inline-flex;width:fit-content;padding:4px 8px;border:1px solid ${p=>p.$enabled?'#315b48':'#514856'};border-radius:6px;color:${p=>p.$enabled?'#a0dbb8':'#c6bdce'};font-size:11px;`
const Footnotes=styled.div`display:flex;flex-direction:column;gap:6px;border-top:1px solid ${p=>p.theme.colors.border.base};padding-top:18px;margin-top:4px;`
const Empty=styled.p`padding:18px 0;font-size:14px;color:${p=>p.theme.colors.text.secondary};`
const DisclosurePanel=styled(Panel).attrs({as:'details'})`display:block;summary{cursor:pointer;list-style-position:outside;margin-left:16px;padding-left:4px}summary h2{display:inline;font-size:22px}summary p{margin-top:8px}summary:focus-visible{outline:2px solid ${p=>p.theme.colors.accent.gold};outline-offset:6px}`
const DisclosureBody=styled.div`display:flex;flex-direction:column;gap:20px;margin-top:24px;`
const BudgetCard=styled.div`padding:20px 0;border-top:1px solid ${p=>p.theme.colors.border.base};display:flex;flex-direction:column;gap:18px;`
const PairList=styled.ul`list-style:none;padding:0;margin:0;li{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:18px 0;border-top:1px solid ${p=>p.theme.colors.border.base}}code{font-size:12px;overflow-wrap:anywhere;color:${p=>p.theme.colors.text.secondary}}`
