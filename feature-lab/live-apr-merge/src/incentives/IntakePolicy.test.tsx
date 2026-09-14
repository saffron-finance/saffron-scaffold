import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {IntakePolicy} from './IntakePolicy'

const mocks=vi.hoisted(()=>({api:vi.fn()}))
vi.mock('../host/transport',()=>({authedJson:mocks.api}))
vi.mock('./styles',()=>({Disclosure:(props:any)=><details open {...props}/>,ErrorText:'p',FinePrint:'p',QuietButton:'button',Row:'div'}))
const account='0x'+'11'.repeat(20) as `0x${string}`
const signer='0x'+'ab'.repeat(20) as `0x${string}`
const policy=(patch:object={})=>({signer,revision:1,mode:'automatic',enabled:true,
  expires_at:new Date(Date.now()+37*60000).toISOString(),service_minutes:725,watcher_id:'payments-v7',...patch})
const report=(value:any)=>({signer,watcherId:value?.watcher_id??'native-eth-v1',readiness:{policy:value,mode:value?.mode,reasons:[],workerOnline:true}})
const onUpdate=vi.fn()
const open=()=>screen.getByRole('button',{name:'Open intake window'})
const pause=()=>screen.getByRole('button',{name:'Pause new requests'})
const reload=()=>screen.getByRole('button',{name:'Load latest settings'})
const field=(name:string)=>screen.getByLabelText(name)
const posts=()=>mocks.api.mock.calls.filter(([,path])=>path==='/admin/intake')
const flush=()=>act(async()=>{})
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));onUpdate.mockClear()
  mocks.api.mockReset().mockImplementation(async(_account,path,body)=>{
    if(path==='/admin/status')return report(policy())
    return{policy:policy({revision:body.revision+1,mode:body.mode,enabled:body.enabled,
      expires_at:body.expiresAt,service_minutes:body.serviceMinutes,watcher_id:body.watcherId})}
  })
})
afterEach(()=>{cleanup();vi.useRealTimers()})

it('reopens saved nondefault watcher, service duration, mode and remaining window without defaults',async()=>{
  render(<IntakePolicy account={account} status={report(policy({revision:7,mode:'reviewed'}))} onUpdate={onUpdate}/>)
  expect(field('Payment watcher ID')).toHaveValue('payments-v7')
  expect(field('Declared service window (minutes)')).toHaveValue(725)
  expect(field('Execution mode')).toHaveValue('reviewed')
  expect(field('Intake window (minutes, at most 1440)')).toHaveValue(37)
  fireEvent.click(open());await flush()
  expect(posts()).toHaveLength(1)
  expect(posts()[0][2]).toEqual({signer,revision:7,mode:'reviewed',enabled:true,
    expiresAt:'2026-09-14T00:37:00.000Z',serviceMinutes:725,watcherId:'payments-v7'})
  expect(screen.getByText('Editing saved revision 8.')).toBeVisible()
})

it('does not attach a refreshed revision to stale form values, including untouched execution mode',async()=>{
  const old=policy(),newer=policy({revision:2,mode:'reviewed',watcher_id:'payments-v8',service_minutes:420})
  const view=render(<IntakePolicy account={account} status={report(old)} onUpdate={onUpdate}/>)
  fireEvent.change(field('Declared service window (minutes)'),{target:{value:'333'}})
  view.rerender(<IntakePolicy account={account} status={report(newer)} onUpdate={onUpdate}/>)
  expect(screen.getByRole('alert')).toHaveTextContent('Intake policy changed elsewhere')
  expect(field('Execution mode')).toHaveValue('automatic')
  expect(field('Declared service window (minutes)')).toHaveValue(333)
  expect(open()).toBeDisabled();expect(pause()).toBeDisabled()
  fireEvent.click(open());expect(posts()).toHaveLength(0)
  // A delayed older poll cannot clear an already-observed conflict.
  view.rerender(<IntakePolicy account={account} status={report(old)} onUpdate={onUpdate}/>)
  expect(open()).toBeDisabled()
  mocks.api.mockResolvedValueOnce(report(newer))
  fireEvent.click(reload());await flush()
  expect(field('Execution mode')).toHaveValue('reviewed')
  expect(field('Payment watcher ID')).toHaveValue('payments-v8')
  expect(field('Declared service window (minutes)')).toHaveValue(420)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(posts()).toHaveLength(0) // Loading never saves automatically.
  fireEvent.click(open());await flush()
  expect(posts()[0][2]).toMatchObject({revision:2,mode:'reviewed',watcherId:'payments-v8',serviceMinutes:420})
})

it('submits the original revision when a concurrent change is not yet polled, and requires reload after 409',async()=>{
  mocks.api.mockRejectedValueOnce(new Error('Intake policy changed. Refresh before saving.'))
  render(<IntakePolicy account={account} status={report(policy())} onUpdate={onUpdate}/>)
  fireEvent.change(field('Payment watcher ID'),{target:{value:'my-unsaved-watcher'}})
  fireEvent.click(open());await flush()
  expect(posts()[0][2]).toMatchObject({revision:1,watcherId:'my-unsaved-watcher'})
  expect(field('Payment watcher ID')).toHaveValue('my-unsaved-watcher')
  expect(screen.getByRole('alert')).toHaveTextContent('Intake policy changed elsewhere')
  expect(open()).toBeDisabled();fireEvent.click(open());expect(posts()).toHaveLength(1)
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('pauses the captured saved policy without applying draft settings or renewing its active expiry',async()=>{
  render(<IntakePolicy account={account} status={report(policy({mode:'reviewed'}))} onUpdate={onUpdate}/>)
  for(const [name,value]of [['Execution mode','automatic'],['Payment watcher ID','draft-only'],['Declared service window (minutes)','111'],['Intake window (minutes, at most 1440)','120']])fireEvent.change(field(name),{target:{value}})
  fireEvent.click(pause());await flush()
  expect(posts()[0][2]).toEqual({signer,revision:1,mode:'reviewed',enabled:false,expiresAt:'2026-09-14T00:37:00.000Z',serviceMinutes:725,watcherId:'payments-v7'})
})

it('uses the acknowledged save revision while an older health report is still visible',async()=>{
  const value=policy(),view=render(<IntakePolicy account={account} status={report(value)} onUpdate={onUpdate}/>)
  fireEvent.click(open());await flush()
  view.rerender(<IntakePolicy account={account} status={report(value)} onUpdate={onUpdate}/>)
  expect(pause()).toBeEnabled();expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(pause());await flush()
  expect(posts().map(([, ,body])=>body.revision)).toEqual([1,2])
})

it('retains a newer concurrent revision that arrives while its own save is pending',async()=>{
  const held=deferred<any>();mocks.api.mockReturnValueOnce(held.promise)
  const old=policy(),view=render(<IntakePolicy account={account} status={report(old)} onUpdate={onUpdate}/>)
  fireEvent.click(open());fireEvent.click(open())
  expect(posts()).toHaveLength(1);expect(field('Execution mode')).toBeDisabled()
  view.rerender(<IntakePolicy account={account} status={report(policy({revision:3,mode:'reviewed'}))} onUpdate={onUpdate}/>)
  await act(async()=>{held.resolve({policy:policy({revision:2})})})
  expect(screen.getByRole('alert')).toHaveTextContent('Intake policy changed elsewhere')
  expect(open()).toBeDisabled();expect(screen.getByText('Editing saved revision 2.')).toBeVisible()
})

it('does not replace conflicted edits with an older reload response',async()=>{
  const view=render(<IntakePolicy account={account} status={report(policy())} onUpdate={onUpdate}/>)
  fireEvent.change(field('Payment watcher ID'),{target:{value:'keep-my-edit'}})
  view.rerender(<IntakePolicy account={account} status={report(policy({revision:2}))} onUpdate={onUpdate}/>)
  fireEvent.click(reload());await flush()
  expect(field('Payment watcher ID')).toHaveValue('keep-my-edit');expect(open()).toBeDisabled()
  expect(screen.getByText('Latest intake settings could not be verified. Refresh again before saving.')).toBeVisible()
})

it('does not invent a conflict from equivalent address casing or timestamp serialization',async()=>{
  const value=policy(),view=render(<IntakePolicy account={account} status={report(value)} onUpdate={onUpdate}/>)
  const equivalent={...report({...value,expires_at:'2026-09-14T00:37:00+00:00'}),signer:'0x'+signer.slice(2).toUpperCase()}
  view.rerender(<IntakePolicy account={account} status={equivalent} onUpdate={onUpdate}/>)
  mocks.api.mockResolvedValueOnce(equivalent)
  fireEvent.click(reload());await flush()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(open()).toBeEnabled()
})

it('separates edits for different connected admin wallets',()=>{
  const view=render(<IntakePolicy account={account} status={report(policy())} onUpdate={onUpdate}/>)
  fireEvent.change(field('Payment watcher ID'),{target:{value:'old-wallet-edit'}})
  view.rerender(<IntakePolicy account={'0x'+'33'.repeat(20) as `0x${string}`} status={report(policy())} onUpdate={onUpdate}/>)
  expect(field('Payment watcher ID')).toHaveValue('payments-v7');expect(posts()).toHaveLength(0)
})

it('uses defaults only for an explicitly absent policy, not malformed saved settings',async()=>{
  const view=render(<IntakePolicy account={account} status={report(policy({watcher_id:undefined}))} onUpdate={onUpdate}/>)
  expect(open()).toBeDisabled();expect(field('Payment watcher ID')).toHaveValue('')
  fireEvent.click(open());expect(posts()).toHaveLength(0)
  view.unmount()
  render(<IntakePolicy account={account} status={report(null)} onUpdate={onUpdate}/>)
  expect(field('Payment watcher ID')).toHaveValue('native-eth-v1');expect(field('Declared service window (minutes)')).toHaveValue(240)
  fireEvent.click(open());await flush();expect(posts()[0][2].revision).toBe(0)
})

it('keeps an expired policy’s saved settings and requires an explicit opening duration',async()=>{
  render(<IntakePolicy account={account} status={report(policy({expires_at:'2026-09-13T20:00:00Z',mode:'reviewed'}))} onUpdate={onUpdate}/>)
  expect(field('Intake window (minutes, at most 1440)')).toHaveValue(null)
  expect(open()).toBeDisabled();expect(field('Payment watcher ID')).toHaveValue('payments-v7')
  fireEvent.change(field('Intake window (minutes, at most 1440)'),{target:{value:'18'}})
  fireEvent.click(open());await flush()
  expect(posts()[0][2]).toMatchObject({revision:1,mode:'reviewed',serviceMinutes:725,watcherId:'payments-v7',expiresAt:'2026-09-14T00:18:00.000Z'})
})

it('freezes mode after creation, discards a stale mode edit and still permits pause/open',async()=>{
 const view=render(<IntakePolicy account={account} status={report(policy())} onUpdate={onUpdate}/>)
 fireEvent.change(field('Execution mode'),{target:{value:'reviewed'}})
 view.rerender(<IntakePolicy account={account} status={report(policy({mode_locked:true}))} onUpdate={onUpdate}/>)
 expect(field('Execution mode')).toBeDisabled();expect(field('Execution mode')).toHaveValue('automatic')
 fireEvent.click(open());await flush()
 expect(posts()[0][2].mode).toBe('automatic')
 fireEvent.click(pause());await flush()
 expect(posts()[1][2]).toMatchObject({mode:'automatic',enabled:false})
})
