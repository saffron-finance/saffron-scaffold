import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {MyVaults} from './MyVaults'
import {VaultLifecyclePanel} from './VaultLifecyclePanel'

// Only the wallet hook is simulated. Real action components keep their labels,
// eligibility gates and click handlers; no provider or transaction is created.
const flow=vi.hoisted(()=>({busy:false,closeBlocked:false,quote:null as any,error:null,pending:null,refresh:vi.fn(),advance:vi.fn(),amountLabel:()=> '50'}))
vi.mock('../host/useVaultPosition',()=>({useVaultPosition:()=>flow}))
const account='0x1111111111111111111111111111111111111111',onOpen=vi.fn(),onBusy=vi.fn()
let row:any
beforeEach(()=>{
  vi.clearAllMocks();flow.busy=false;flow.closeBlocked=false
  flow.quote={tokens:[{symbol:'CASHCAT'},{symbol:'USDG'}],action:{label:'Deposit'},blocked:null}
  row={id:'ready-request',state:'depositable',depositable:true,canClaim:false,canWithdraw:false,canRecover:false,transactions:[],snapshot:{display:{pair:'CASHCAT / USDG'},fixedCapacityAmount:'10000',durationSeconds:259200},plan:{premium:'8210000000000000000',variableDecimals:18,variableSymbol:'USDG'}}
})
afterEach(cleanup)

/** Render the existing Portfolio with a verified or last-known request. */
function portfolio(stale=false){
  const positions={rows:[row],verificationUnavailable:stale,payments:[],page:1,paymentPage:1,refresh:vi.fn()} as any
  return render(<ThemeProvider theme={darkTheme}><MyVaults account={account} positions={positions} payments={[]} onConnect={vi.fn()} onBack={vi.fn()} onAdmin={vi.fn()} onResumePayment={vi.fn()} onOpen={onOpen}/></ThemeProvider>)
}
/** Keep real lifecycle rendering but replace the wallet boundary above. */
function position(){return render(<ThemeProvider theme={darkTheme}><VaultLifecyclePanel account={account} id={row.id} row={row} onBusy={onBusy}/></ThemeProvider>)}

it('opens verified Portfolio deposits with the shared primary treatment',()=>{
  portfolio();const button=screen.getByRole('button',{name:'Deposit',exact:true})
  expect(button).toHaveAttribute('data-incentive-primary-action')
  fireEvent.click(button);expect(onOpen).toHaveBeenCalledExactlyOnceWith(row.id,true)
})
it('keeps last-known Portfolio rows informational, not actionable deposits',()=>{
  portfolio(true);expect(screen.queryByRole('button',{name:'Deposit',exact:true})).toBeNull()
  const button=screen.getByRole('button',{name:'View request'})
  expect(button).not.toHaveAttribute('data-incentive-primary-action')
  fireEvent.click(button);expect(onOpen).toHaveBeenCalledExactlyOnceWith(row.id,false)
})
it.each(['Wrap ETH','Approve CASHCAT','Reset USDG','Deposit'])('keeps %s in the purple deposit flow with an explicit click',label=>{
  flow.quote.action.label=label;position();const button=screen.getByRole('button',{name:label,exact:true})
  expect(button).toHaveAttribute('data-incentive-primary-action');expect(button).toBeEnabled();expect(flow.advance).not.toHaveBeenCalled()
  fireEvent.click(button);expect(flow.advance).toHaveBeenCalledOnce()
})
it.each(['loading','blocked','preparing','confirming'])('does not enable a purple deposit action while %s',state=>{
  if(state==='loading')flow.quote=null
  if(state==='blocked')flow.quote.blocked='Insufficient token balance'
  if(state==='preparing'||state==='confirming')flow.busy=true
  if(state==='confirming')flow.closeBlocked=true
  const {container}=position(),button=container.querySelector('[data-incentive-primary-action]')!
  expect(button).toBeDisabled();fireEvent.click(button);expect(flow.advance).not.toHaveBeenCalled()
})
it.each([['canClaim','Claim premium'],['canWithdraw','Withdraw'],['canRecover','Recover LP assets']])('leaves %s styling and behavior unchanged', (flag,label)=>{
  row.depositable=false;row[flag]=true;flow.quote.action.label=label
  const view=portfolio(),button=screen.getByRole('button',{name:label,exact:true})
  expect(button).not.toHaveAttribute('data-incentive-primary-action');fireEvent.click(button);expect(onOpen).toHaveBeenCalledExactlyOnceWith(row.id,true)
  view.unmount();position();const action=screen.getByRole('button',{name:label,exact:true})
  expect(action).not.toHaveAttribute('data-incentive-primary-action');fireEvent.click(action);expect(flow.advance).toHaveBeenCalledOnce()
})
