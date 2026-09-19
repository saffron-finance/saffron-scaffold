import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '../../vendor/fixed-income-ui/shared/styles/themes/darkTheme'
import GlobalStyles from '../../vendor/fixed-income-ui/globalStyles'
import {IncentiveModal} from '../../src/incentives/IncentiveModal'
import '../../src/host/fonts.css'

// This preview renders the production modal and real status hook. Only input
// props and HTTP responses are mocked. It never installs a wallet provider.
const account='0x1111111111111111111111111111111111111111'
const token0={address:'0x020bfc650a365f8bb26819deaabf3e21291018b4',symbol:'CASHCAT',decimals:18}
const token1={address:'0x5fc5360d0400a0fd4f2af552add042d716f1d168',symbol:'USDG',decimals:18}
const offer={id:'preview-program',pairId:'preview-pair',chainId:4663,token0,token1,feeTier:10000,apr:1000,days:3,requestFeeWei:'4000000000000000',active:true,availability:null,budget:{paused:false,reconciliationRequired:false}}
const quote={id:'preview-quote',principalCents:'10000',snapshot:{durationSeconds:259200},fee:{amountWei:'4000000000000000'},plan:{token0,token1,premiumCents:'821',premium:'8210000000000000000',variableDecimals:18,variableSymbol:'CASHCAT',liquidity:'1000000000000',sqrtPrice:'79228162514264337593543950336',minTick:-887220,maxTick:887220}}
const requestedAt=new Date().toISOString(),hash='0x'+'a'.repeat(64)
let row:any={id:'preview-request',plan:quote.plan,snapshot:quote.snapshot,createdAt:requestedAt,state:'creating',depositable:false,canClaim:false,canWithdraw:false,canRecover:false,transactions:[],progress:{reason:'creating',activeStage:1,stages:[1,2,3,4].map(id=>({id,name:'Stage '+id,state:'pending'})),requestedAt,lastProgressAt:requestedAt,serviceWindowMinutes:15}}
let unavailable=false,reads=0,payCalls=0,cancellations=0,releaseQuote:(value:any)=>void,releasePayment:()=>void
let quotePromise:Promise<any>|null=null
const realFetch=window.fetch.bind(window)
window.fetch=async(input,options)=>{
 const url=String(input)
 if(!url.includes('/api/'))return realFetch(input,options)
 if(options?.method&&options.method!=='GET')throw Error('Unexpected API write in presentation fixture')
 if(!url.includes('/deployments/preview-request?wallet='))throw Error('Unexpected API read in presentation fixture: '+url)
 reads++;return new Response(JSON.stringify(unavailable?{error:'Fixture verification unavailable'}:{deployment:row}),{status:unavailable?503:200,headers:{'content-type':'application/json'}})
}
const cancelPreparation=()=>{cancellations++}
/** Deferred quote/payment props let real Claim/Close controls be exercised,
 * without signing or broadcasting anything. Status changes require evidence. */
function App(){
 const [prepared,setPrepared]=useState<any>(null),[preparing,setPreparing]=useState(false),[deployment,setDeployment]=useState<any>(null),[open,setOpen]=useState(true)
 const review=()=>{if(!quotePromise){setPreparing(true);quotePromise=new Promise(resolve=>{releaseQuote=value=>{setPrepared(value);setPreparing(false);resolve(value)}})}return quotePromise}
 const flow={draft:{amountUsd:'100'},quote:prepared,preparing,busy:false,deployment,review,cancelPreparation,reset:async()=>{setPrepared(null);quotePromise=null},pay:async()=>{payCalls++;await new Promise<void>(resolve=>{releasePayment=resolve})}}
 ;(window as any).depositFixture={
  quoteReady:()=>releaseQuote(quote),
  accept:()=>{setDeployment(row);releasePayment()},
  stage:(stage:number,reason='creating')=>{row={...row,progress:{...row.progress,reason,activeStage:stage}};window.dispatchEvent(new Event('saffron:vault-updated'))},
  ready:()=>{row={...row,state:'ready',depositable:true,transactions:[{hash,step:'create-vault',confirmed:true}],progress:{...row.progress,reason:'ready',activeStage:null}};window.dispatchEvent(new Event('saffron:vault-updated'))},
  fail:(value:boolean)=>{unavailable=value;window.dispatchEvent(new Event('saffron:vault-updated'))},
  reopen:()=>setOpen(true),
  stats:()=>({reads,payCalls,cancellationCallbacks:cancellations,walletTransactions:0,productionWrites:0}),
 }
 return <ThemeProvider theme={darkTheme}><GlobalStyles/><main style={{padding:'48px',color:'#eee'}}><h1>Saffron</h1><p>Incentive programs</p></main>{open&&<IncentiveModal offer={offer as any} account={account} flow={flow as any} price={{value:{quotePerToken:1,quoteUsd:1},loading:false} as any} onClose={()=>setOpen(false)} onConnect={()=>{throw Error('No wallet is used by this preview')}}/>}</ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<App/>)
