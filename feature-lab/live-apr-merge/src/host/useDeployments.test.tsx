import { act,cleanup,renderHook,waitFor } from '@testing-library/react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { useDeployments } from './useDeployments'
const mocks=vi.hoisted(()=>({read:vi.fn(),session:vi.fn(),login:vi.fn()}))
vi.mock('./transport',()=>({requestJson:mocks.read,readSession:mocks.session,ensureOperatorSession:mocks.login}))
const account='0x1111111111111111111111111111111111111111'
const rows={deployments:[{id:'healthy',depositable:true}],creatorOnline:true,nextCursor:null,positionsUpdating:false}
const never=()=>new Promise(()=>{})
beforeEach(()=>{mocks.read.mockReset().mockImplementation(async(path:string)=>path.startsWith('/payments')?{payments:[],nextCursor:null}:rows);mocks.session.mockReset().mockResolvedValue(null)})
afterEach(()=>{cleanup();vi.restoreAllMocks()})

it.each(['stalls','fails'])('publishes actionable vaults when payment history %s',async kind=>{
  mocks.read.mockImplementation((path:string)=>path.startsWith('/payments')?(kind==='stalls'?never():Promise.reject(Error('Payment history down'))):Promise.resolve(rows))
  const {result}=renderHook(()=>useDeployments(account))
  await waitFor(()=>expect(result.current.rows).toEqual(rows.deployments))
  expect(result.current.loading).toBe(false)
  expect(result.current.verificationUnavailable).toBe(false)
  expect(result.current.error).toBeUndefined()
  if(kind==='fails')await waitFor(()=>expect(result.current.paymentError).toBe('Payment history down'))
})

it.each([false,true])('does not gate vaults on session discovery, admin=%s',async admin=>{
  mocks.session.mockImplementation(never)
  const {result}=renderHook(()=>useDeployments(account,admin))
  await waitFor(()=>expect(result.current.rows).toEqual(rows.deployments))
  expect(result.current.loading).toBe(false)
  expect(mocks.read.mock.calls.some(([path])=>path==='/admin/status')).toBe(false)
  if(!admin)expect(mocks.read.mock.calls.some(([path])=>path==='/deployments?wallet='+account)).toBe(true)
})

it('keeps a primary failure local while payment history succeeds',async()=>{
  mocks.read.mockImplementation((path:string)=>path.startsWith('/payments')?Promise.resolve({payments:[{hash:'payment'}],nextCursor:null}):Promise.reject(Error('Vault list down')))
  const {result}=renderHook(()=>useDeployments(account))
  await waitFor(()=>expect(result.current.payments).toHaveLength(1))
  expect(result.current.verificationUnavailable).toBe(true)
  expect(result.current.paymentError).toBeUndefined()
})

it('does not publish old wallet rows after a wallet change',async()=>{
  let release!:(value:unknown)=>void
  mocks.read.mockImplementation((path:string)=>path.includes('/deployments?wallet='+account)?new Promise(done=>{release=done}):Promise.resolve(path.startsWith('/payments')?{payments:[],nextCursor:null}:{...rows,deployments:[{id:'new-wallet'}]}))
  const {result,rerender}=renderHook(({wallet})=>useDeployments(wallet as typeof account),{initialProps:{wallet:account as string}})
  rerender({wallet:'0x2222222222222222222222222222222222222222'})
  await waitFor(()=>expect(result.current.rows[0]?.id).toBe('new-wallet'))
  await act(async()=>release(rows))
  expect(result.current.rows[0]?.id).toBe('new-wallet')
})
