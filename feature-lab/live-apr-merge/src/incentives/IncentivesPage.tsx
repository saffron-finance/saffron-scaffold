import { HomeCatalog } from './HomeCatalog'
import './IncentivesPage.css'
import { lazy,Suspense,useEffect,useRef,useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Address } from 'viem'
import { StepTitle } from '../host/ui'
import { useDeploymentFlow } from '../host/useDeploymentFlow'
import { useDeployments } from '../host/useDeployments'
import { useOfferPrice } from '../host/useOfferPrice'
import { useIncentivePrograms } from '../host/useIncentivePrograms'
import { isOfferLive,type Offer } from './model'
import { FinePrint,QuietButton } from './styles'
// Secondary screens share the shell but download only on first use. Their
// module cache and hashed browser assets serve subsequent visits immediately.
const IncentiveModal=lazy(()=>import('./IncentiveModal').then(module=>({default:module.IncentiveModal})))
const MyVaults=lazy(()=>import('./MyVaults').then(module=>({default:module.MyVaults})))
const CreateIncentiveProgramPage=lazy(()=>import('./CreateIncentiveProgramPage').then(module=>({default:module.CreateIncentiveProgramPage})))
const ProgramAdmin=lazy(()=>import('./ProgramAdmin').then(module=>({default:module.ProgramAdmin})))
const OperatorStatus=lazy(()=>import('./OperatorStatus').then(module=>({default:module.OperatorStatus})))
const JourneyGuide=lazy(()=>import('./JourneyGuide').then(module=>({default:module.JourneyGuide})))
const IncentivesAdmin=lazy(()=>import('./IncentivesAdmin').then(module=>({default:module.IncentivesAdmin})))

export default function IncentivesPage(props:{account:Address|null;onConnect:()=>void}){
  const [selected,setSelected]=useState<Offer|null>(null)
  return <WalletPage key={props.account??'guest'} {...props} selected={selected} setSelected={setSelected}/>
}
function WalletPage({account,onConnect,selected,setSelected}:{account:Address|null;onConnect:()=>void;selected:Offer|null;setSelected:(offer:Offer|null)=>void}){
  // Only Portfolio consumes the user history. Other pages must not poll it in
  // the background; the flow still restores pending checkout/payment records.
  const route=useLocation().pathname.replace(/\/+$/,'')||'/'
  const flow=useDeploymentFlow(account),positions=useDeployments(route==='/portfolio/vaults'?account:null),catalog=useIncentivePrograms()
  const [vaultId,setVaultId]=useState<string|null>(null),[resume,setResume]=useState(false),[openPosition,setOpenPosition]=useState(false)
  const navigate=useNavigate()
  const previousRoute=useRef(route)
  useEffect(()=>{
    if(previousRoute.current===route)return
    previousRoute.current=route
    flow.cancelPreparation();setSelected(null);setVaultId(null);setResume(false)
  },[route,flow.cancelPreparation,setSelected])
  // Keep the cached amount preview available during background quote cleanup.
  // Its own shared cache/timer bounds reads; Back never waits for a fresh RPC.
  const price=useOfferPrice(flow.quote?null:selected)
  // Preserve the opener across asynchronous checkout selection and disabled paint.
  const opener=useRef<HTMLElement|null>(null),opening=useRef(false)
  async function openOffer(offer:Offer,target:HTMLElement){
    // Native disabled controls handle pointer/keyboard input; this also guards
    // against a direct handler call while the catalog says the offer is not live.
    if(opening.current||flow.busy||catalog.loading||catalog.error||!catalog.canAct()||!isOfferLive(offer))return
    opening.current=true
    try{
    opener.current=target
    if(flow.draft?.programId===offer.id||flow.saved&&!flow.saved.sent&&flow.saved.quote.programId===offer.id)flow.restore()
    else{
      if((flow.draft||flow.saved&&!flow.saved.sent)&&!await flow.reset())return
      if(!await flow.startNew())return
    }
    setSelected(offer);setVaultId(null);setResume(false);setOpenPosition(false)
    }finally{opening.current=false}
  }
  function close(){const target=opener.current;opener.current=null;requestAnimationFrame(()=>{if(target?.isConnected)target.focus()});setSelected(null);setVaultId(null);setResume(false);positions.refresh();catalog.refresh()}
  return <section className='saffron-catalog-page' data-catalog-home={route==='/'}><Suspense fallback={<div className='saffron-catalog-route-skeleton' role='status' aria-label='Loading page content'><i/><i/><i/></div>}>
    {route==='/status'?<OperatorStatus account={account} onConnect={onConnect} onNavigate={navigate}/>:route==='/journey'?<JourneyGuide onNavigate={navigate}/>:route==='/incentive-programs/new'?<><div className='saffron-catalog-title-row'><StepTitle>Create incentive program</StepTitle><QuietButton onClick={()=>navigate('/incentive-programs')}>Back to incentive programs</QuietButton></div><CreateIncentiveProgramPage account={account} onConnect={onConnect} onBack={()=>navigate('/incentive-programs')}/></>:route==='/incentive-programs'?<><div className='saffron-catalog-title-row'><StepTitle>Incentive programs</StepTitle><QuietButton onClick={()=>navigate('/')}>Home</QuietButton></div><ProgramAdmin autoLoad account={account} onConnect={onConnect} onCreate={()=>navigate('/incentive-programs/new')}/></>:route==='/admin'?<IncentivesAdmin account={account} onConnect={onConnect} onNavigate={navigate} onBack={()=>navigate('/')} checkoutRecovery={flow.draft&&<div className='saffron-catalog-recovery'><FinePrint>An unpaid checkout review is saved.</FinePrint><QuietButton disabled={!catalog.offers.some(o=>o.id===flow.draft?.programId)} onClick={()=>{const offer=catalog.offers.find(o=>o.id===flow.draft?.programId);if(offer){flow.restore();setSelected(offer);setVaultId(null);setResume(false);setOpenPosition(false)}}}>Resume checkout</QuietButton><QuietButton disabled={flow.busy} onClick={()=>void flow.reset()}>Discard unpaid checkout</QuietButton></div>}/>:route==='/portfolio/vaults'?<MyVaults account={account} positions={positions} onConnect={onConnect} onBack={()=>navigate('/')} onOpen={(id,position=false)=>{setVaultId(id);setOpenPosition(position)}} payments={flow.records.filter(p=>p.sent&&!p.deploymentId)} onResumePayment={async(id)=>{await flow.resumePayment(id);setSelected(null);setVaultId(null);setResume(true)}} onAdmin={()=>navigate('/admin')}/>:<>
      <HomeCatalog catalog={catalog} busy={flow.busy} onOpen={(offer,target)=>void openOffer(offer,target)} recovery={flow.saved?.sent&&<div className='saffron-catalog-recovery'><FinePrint>A creation payment request is saved.</FinePrint><QuietButton onClick={()=>setResume(true)}>Resume deployment</QuietButton></div>}/>
    </>}
    </Suspense>
    {/* A dialog download must not hide the page or its focus-return target. */}
    <Suspense fallback={<FinePrint role='status'>Opening vault details…</FinePrint>}>{(selected||vaultId||resume)&&<IncentiveModal offer={selected} account={account} flow={flow} price={price} deploymentId={vaultId} openPosition={openPosition} onClose={close} onConnect={onConnect}/>}</Suspense>
  </section>
}
// First-screen geometry lives in the adjacent cached stylesheet.
