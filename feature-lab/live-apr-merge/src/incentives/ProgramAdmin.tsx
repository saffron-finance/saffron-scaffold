import {useEffect,useRef,useState,type FormEvent} from 'react'
import {formatUnits,type Address} from 'viem'
import styled from 'styled-components'
import {ConfigurationWarnings} from './ConfigurationWarnings'
import {ProgramDeployerBalance} from './DeployerBalance'
import {PairEditor} from './PairEditor'
import {FundingAccounting,accountingUsd} from './FundingAccounting'
import {ProgramIdentifier} from './ProgramIdentifier'
import {programReference,programText} from './program-language'
import {requestFeeFromEth} from '../../shared/incentives.mjs'
import {authedJson} from '../host/transport'
import {usd,type Budget,type Program} from './model'
import {ErrorText,FinePrint,QuietButton,Row,Stack} from './styles'
import {Field,InlineForm,Panel,SectionIntro,poolHeading,useProgramCatalog} from './program-admin'
import {AdminAction,AdminOutline as SaveButton,AdminBadge,AdminGold,AdminKicker} from './admin-workspace-styles'

/** Program directory and one selected program, matching the server console's
 * search/card/detail hierarchy. Selection is read-only and uses a shareable
 * display reference; every mutation still sends the untouched catalog record. */
export function ProgramAdmin({account,onConnect,onCreate,autoLoad=false}:{account:Address|null;onConnect:()=>void;onCreate:()=>void;autoLoad?:boolean}){
  const {catalog,busy,error,load}=useProgramCatalog(account,onConnect,autoLoad)
  const [showPair,setShowPair]=useState(false),[saved,setSaved]=useState(''),[actionError,setActionError]=useState(''),[pausing,setPausing]=useState(false),[search,setSearch]=useState('')
  const [selectedRef,setSelectedRef]=useState(readSelection)
  const accountingRef=useRef<HTMLDetailsElement>(null),pairsRef=useRef<HTMLDetailsElement>(null)
  /** In-page destinations do not overwrite the program identity in the hash. */
  function reveal(node:HTMLDetailsElement|null){if(node){node.open=true;node.scrollIntoView?.({block:'start',behavior:'smooth'})}}
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
    return <>
      <SettingsGrid>
        <SettingsSection><h3>Request fee</h3><RequestFeeEditor key={program.id} account={account} program={program} onSaved={changed}/><FinePrint>Exact ETH for new requests. Network gas is separate.</FinePrint></SettingsSection>
        <SettingsSection><h3>Planning budget</h3>{budget?.campaign?<AdvisoryTarget key={program.id+':'+budget.id} account={account} budget={budget} programId={program.id} onSaved={changed}/>:<FinePrint>{budget?'Legacy token allocation — see accounting below.':'Budget unavailable'}</FinePrint>}{budget?.campaign?.capacityCents&&<FinePrint>{usd(Number(budget.campaign.capacityCents)/100)} original fixed-side capacity target</FinePrint>}</SettingsSection>
      </SettingsGrid>
      <MiniSummary aria-label='Selected program funding summary'>
        <div><dt>Premium funded</dt><dd>{accountingUsd(budget?.accounting?.fundedBudgetCents)}</dd></div>
        <div><dt>Premium requested</dt><dd>{accountingUsd(budget?.requestStatistics?.totalPremiumCents)}</dd></div>
        <div><dt>LP requests</dt><dd>{budget?.requestStatistics?.requestCount!=null&&/^\d+$/.test(budget.requestStatistics.requestCount)?BigInt(budget.requestStatistics.requestCount).toLocaleString('en-US'):'Unavailable'}</dd></div>
      </MiniSummary>
      <Controls><Row><h3>Program controls</h3>{budget&&<SaveButton onClick={()=>void pause(budget)}>{budget.paused?'Resume incentive program':'Pause incentive program'}</SaveButton>}</Row>{shared&&<FinePrint>Pause / resume affects all programs sharing this budget.</FinePrint>}{budget?.reconciliationRequired&&<ErrorText>Reconcile accounting before accepting requests.</ErrorText>}{!program.active&&<FinePrint>This program is disabled. Resuming its budget does not enable it.</FinePrint>}<FinePrint>Shared service checks and intake are managed separately in Server Admin.</FinePrint></Controls>
    </>
  }
  return <Stack>
    <Row><SectionIntro><FinePrint>Manage incentive programs, review funding, and maintain supported pairs.</FinePrint><FinePrint>Planning targets are estimates, not request limits. Program settings do not override shared request intake.</FinePrint></SectionIntro><NewButton onClick={onCreate}>New incentive program</NewButton></Row>
    <WorkspacePanel aria-label='Program configuration'>
      <Row><SectionIntro><h2>Incentive programs</h2><FinePrint>{catalog?`${catalog.programs.length} programs · including paused and disabled`:'Sign in with an operator wallet to view incentive program settings.'}</FinePrint></SectionIntro><SaveButton disabled={busy||pausing} onClick={()=>{setSaved('');void load()}}>{busy?'Loading incentive programs…':catalog?'Reload incentive programs':'Load incentive catalog'}</SaveButton></Row>
      {error&&<ErrorText role='alert'>{programText(error)} Reload before editing settings.</ErrorText>}{actionError&&<ErrorText role='alert'>{actionError}</ErrorText>}{saved&&<FinePrint role='status'>{saved}</FinePrint>}
      {catalog&&account&&<>
        <Toolbar><Field>Find a program<input type='search' aria-label='Find a program' placeholder='Pair, duration, or program ID' value={search} onChange={e=>setSearch(e.target.value)}/></Field><FinePrint role='status'>{filtered.length} of {catalog.programs.length} programs · including paused and disabled</FinePrint></Toolbar>
        <Workspace>
          <Navigator aria-label='Incentive program navigator'>
            {!catalog.programs.length?<Empty>No incentive programs yet. Use New incentive program to configure one.</Empty>:<>
              <ProgramCards aria-label='Incentive programs'>{filtered.map(program=>{
                const label=state(program),fee=program.requestFeeWei==null?'Not configured':formatUnits(BigInt(program.requestFeeWei),18)+' ETH'
                return <li key={program.id} data-program-id={program.id} data-budget-id={program.budgetPoolId}><ProgramCard type='button' aria-pressed={selected?.id===program.id} aria-label={'Open incentive program '+programReference(program.id)} onClick={()=>select(program.id)}>
                  <Row><ProgramName>{poolHeading(catalog.pairs.find(p=>p.id===program.pairId))}</ProgramName><FinePrint>{program.days} days</FinePrint></Row>
                  <AdminGold>{aprText(program)}<small>APR</small></AdminGold>
                  <Row><FinePrint>{fee} request fee</FinePrint><AdminBadge $tone={label==='Enabled'?'approved':label==='Needs attention'?'review':'neutral'}>{label}</AdminBadge></Row>
                  <ProgramIdentifier id={program.id}/>{linked(program.budgetPoolId).length>1&&<FinePrint>Shared budget</FinePrint>}
                </ProgramCard></li>
              })}</ProgramCards>
              {!filtered.length&&<Empty>No incentive programs match this search.</Empty>}
            </>}
            <SaveButton onClick={()=>reveal(pairsRef.current)}>Pair management →</SaveButton>
          </Navigator>
          <DetailPanel>
            {selectedRef?selected?<section aria-label='Incentive program details' data-program-detail={selected.id} data-program-id={selected.id} data-budget-id={selected.budgetPoolId}>
              <DetailHeader><Row><AdminKicker>Selected incentive program</AdminKicker><AdminBadge $tone={state(selected)==='Enabled'?'approved':state(selected)==='Needs attention'?'review':'neutral'}>{state(selected)}</AdminBadge></Row><h3>{poolHeading(catalog.pairs.find(p=>p.id===selected.pairId))}</h3><ProgramIdentifier id={selected.id}/>
                <DetailTerms><LargeApr>{aprText(selected)}<small>APR</small></LargeApr><div><FinePrint>Term</FinePrint><strong>{selected.days} days</strong><FinePrint>Infinite range</FinePrint></div></DetailTerms>
              </DetailHeader>
              <DetailNav><span>Configuration</span><button type='button' onClick={()=>reveal(accountingRef.current)}>Funding &amp; accounting ↓</button></DetailNav>
              <EditScope disabled={busy||pausing||!!error} aria-label='Incentive program settings'>{settings(selected)}<Footnotes><FinePrint>Planning budget edits do not change quoted APR or capacity.</FinePrint><FinePrint>Request fee is a fixed ETH amount for new quotes, plus wallet network gas. Existing payments and refunds keep their original terms.</FinePrint></Footnotes></EditScope>
              <BackButton aria-label='All incentive programs' onClick={()=>select(null)}>← All incentive programs</BackButton>
            </section>:<Empty>This incentive program is no longer in the current catalog.</Empty>:<SelectionHint><AdminKicker>Program workspace</AdminKicker><h3>Select an incentive program</h3><FinePrint>Choose a program to review its terms, edit its request fee and planning target, and inspect funding.</FinePrint><FinePrint>Program settings stay separate from server-wide services and intake.</FinePrint></SelectionHint>}
          </DetailPanel>
        </Workspace>
      </>}
    </WorkspacePanel>
    {autoLoad&&!selectedRef&&<DisclosurePanel><summary><h2>Shared service status</h2><FinePrint>Deployer gas and application configuration · independent of program settings</FinePrint></summary><DisclosureBody><ProgramDeployerBalance account={account}/><ConfigurationWarnings compact account={account}/></DisclosureBody></DisclosurePanel>}
    {catalog&&account&&<>
      {!!budgets.length&&<DisclosurePanel ref={accountingRef}><summary><h2>Funding &amp; accounting</h2><FinePrint>{budgets.length} budgets · external premium funding and observed LP deposits</FinePrint></summary><DisclosureBody>
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
      {<DisclosurePanel ref={pairsRef}><summary><h2>Pair management</h2><FinePrint>{catalog.pairs.length} configured pairs · pool addresses and availability</FinePrint></summary><DisclosureBody>
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
    {error&&<ErrorText role='alert'>{error}</ErrorText>}<FeeSave disabled={busy||conflict||!draft.dirty}>{busy?'Saving fee…':'Save request fee'}</FeeSave>
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

/** APR is a display value only; formatting cannot alter quote economics. */
function aprText(program:Program){return Number.isFinite(Number(program.apr))?Number(program.apr).toLocaleString('en-US',{maximumFractionDigits:4})+'%':'Unavailable'}
const NewButton=styled(AdminAction)`min-width:150px;`
const FeeSave=styled(AdminAction)`width:100%;`
const WorkspacePanel=styled(Panel)`border:0;background:transparent;padding:0;@media(max-width:650px){padding:0}`
const EditScope=styled.fieldset`border:0;padding:0;margin:0;min-width:0;`
const Toolbar=styled.div`display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:2px 0 4px;>label{flex:1;max-width:580px}input{min-height:54px;padding:13px 18px;background:#0a0a0a;border-color:#413847;font:18px ${p=>p.theme.fonts.display}}input:focus-visible{outline-color:#d286ff}>p{font-size:11px;text-align:right}@media(max-width:760px){flex-direction:column;align-items:stretch;>label{max-width:none}>p{text-align:left}input{font-size:16px}}`
const Workspace=styled.div`display:grid;grid-template-columns:minmax(240px,300px) minmax(0,1fr);gap:24px;align-items:start;@media(min-width:1500px){grid-template-columns:335px minmax(0,1fr)}@media(max-width:950px){grid-template-columns:minmax(0,1fr)}`
const Navigator=styled.aside`min-width:0;display:flex;flex-direction:column;gap:18px;>button{width:100%}`
const ProgramCards=styled.ul`list-style:none;padding:0;margin:0;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;>li{min-width:0}`
const ProgramCard=styled.button`width:100%;min-width:0;padding:22px;display:flex;flex-direction:column;gap:17px;text-align:left;color:inherit;font:inherit;cursor:pointer;background:#080808;border:1px solid #302a34;border-radius:9px;>div{align-items:flex-start;gap:10px}p{font-size:11px}code{font-size:10px;overflow-wrap:anywhere}&[aria-pressed=true]{border-color:#a26cbb;background:linear-gradient(135deg,#211329,#0d0a10);box-shadow:inset 2px 0 #be83dc}&:hover{border-color:#b77ac9}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px}@media(max-width:760px){padding:20px}`
const ProgramName=styled.strong`font:400 20px/1.35 ${p=>p.theme.fonts.display};`
const DetailPanel=styled.div`min-width:0;border:1px solid #302a34;border-radius:10px;background:#0a090b;padding:28px;@media(max-width:650px){padding:20px 14px}`
const SelectionHint=styled.div`min-height:300px;display:flex;flex-direction:column;justify-content:center;gap:18px;max-width:520px;h3{font-size:25px}@media(max-width:650px){min-height:200px}`
const BackButton=styled(QuietButton)`margin-top:18px;color:#cf94df;padding-left:0;min-height:44px;`
const DetailHeader=styled.div`display:flex;flex-direction:column;gap:13px;h3{font-size:25px;line-height:1.35}code{overflow-wrap:anywhere}`
const DetailTerms=styled.div`display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:16px 0 10px;strong{font:400 24px/1.5 ${p=>p.theme.fonts.display}}`
const LargeApr=styled(AdminGold)`font-size:60px;small{font-size:15px}@media(max-width:650px){font-size:48px}`
const DetailNav=styled.div`display:flex;gap:22px;align-items:stretch;margin-top:20px;border-bottom:1px solid #332b38;font-size:12px;flex-wrap:wrap;span,button{padding:12px 0;color:#b2a3ba}span{border-bottom:2px solid #b37ccd;color:#e8cef3}button{border:0;background:transparent;font:inherit;cursor:pointer;min-height:44px}button:focus-visible{outline:2px solid #d286ff;outline-offset:3px}`
const SettingsGrid=styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:24px;padding:24px 0;`
const SettingsSection=styled.section`display:flex;flex-direction:column;gap:13px;min-width:0;h3{font-size:17px}form>button{width:100%}input{background:#0c0a0d;border-color:#413847}input:focus-visible{outline-color:#d286ff}`
const MiniSummary=styled.dl`display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:20px;margin:0;padding:23px 0;border-top:1px solid #302a34;border-bottom:1px solid #302a34;>div{min-width:0}dt{font-size:11px;color:#a99aae;margin-bottom:9px}dd{margin:0;font:400 24px/1.4 ${p=>p.theme.fonts.display};font-variant-numeric:tabular-nums;overflow-wrap:anywhere}`
const Controls=styled.div`display:flex;flex-direction:column;gap:12px;padding:20px 0;h3{font-size:17px}`
const Status=styled.span<{$enabled:boolean}>`align-self:flex-start;display:inline-flex;width:fit-content;padding:4px 8px;border:1px solid ${p=>p.$enabled?'#315b48':'#514856'};border-radius:6px;color:${p=>p.$enabled?'#a0dbb8':'#c6bdce'};font-size:11px;`
const Footnotes=styled.div`display:flex;flex-direction:column;gap:6px;border-top:1px solid ${p=>p.theme.colors.border.base};padding-top:18px;margin-top:4px;`
const Empty=styled.p`padding:18px 0;font-size:14px;color:${p=>p.theme.colors.text.secondary};`
const DisclosurePanel=styled(Panel).attrs({as:'details'})`display:block;summary{cursor:pointer;list-style-position:outside;margin-left:16px;padding-left:4px}summary h2{display:inline;font-size:22px}summary p{margin-top:8px}summary:focus-visible{outline:2px solid ${p=>p.theme.colors.accent.gold};outline-offset:6px}`
const DisclosureBody=styled.div`display:flex;flex-direction:column;gap:20px;margin-top:24px;`
const BudgetCard=styled.div`padding:20px 0;border-top:1px solid ${p=>p.theme.colors.border.base};display:flex;flex-direction:column;gap:18px;`
const PairList=styled.ul`list-style:none;padding:0;margin:0;li{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:18px 0;border-top:1px solid ${p=>p.theme.colors.border.base}}code{font-size:12px;overflow-wrap:anywhere;color:${p=>p.theme.colors.text.secondary}}`
