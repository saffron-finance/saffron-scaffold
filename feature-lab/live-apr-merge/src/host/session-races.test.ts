import {afterEach,expect,it,vi} from 'vitest'
import {readSession,rememberPayment,ensureOperatorSession,setViewerWallet,requestJson} from './transport'
const wallet=vi.hoisted(()=>({assert:vi.fn(async()=>{}),sign:vi.fn()}))
vi.mock('@lab/wallet/wallet',()=>({assertWalletAccount:wallet.assert,walletClient:()=>({signMessage:wallet.sign})}))
const account='0x1111111111111111111111111111111111111111'
afterEach(()=>{setViewerWallet(null);vi.unstubAllGlobals();vi.clearAllMocks();localStorage.clear()})

it.each([200,401,403])('M05: delayed %s discovery cannot erase a newer authenticated session',async status=>{
  let finish!:(response:Response)=>void
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',fetcher)
  const discovery=readSession(account)
  const authenticated={wallet:account,csrf:'fixture',operator:true,expires:Date.now()+60_000}
  rememberPayment(account,{},authenticated)
  finish(Response.json(status===200?{session:null}:{error:'anonymous',code:'wallet_session_required'},{status}))
  expect(await discovery).toEqual(authenticated)
  expect(await ensureOperatorSession(account)).toEqual(authenticated)
  expect(fetcher).toHaveBeenCalledTimes(1);expect(wallet.sign).not.toHaveBeenCalled()
})

it.each([false,true])('wallet-expiry marker, not an ordinary permission denial, clears the cached session: %s',async expired=>{
  const authenticated={wallet:account,csrf:'fixture',operator:true,expires:Date.now()+60_000}
  setViewerWallet(account);rememberPayment(account,{},authenticated)
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'Sign in again',...(expired?{code:'wallet_session_required'}:{})},{status:403}))
  vi.stubGlobal('fetch',fetcher)
  await expect(requestJson('/admin/health')).rejects.toThrow('Sign in again')
  if(!expired){expect(await ensureOperatorSession(account)).toEqual(authenticated);expect(fetcher).toHaveBeenCalledTimes(1)}
  else{
    fetcher.mockResolvedValueOnce(Response.json({error:'Fresh challenge requested'},{status:503}))
    await expect(ensureOperatorSession(account)).rejects.toThrow('Fresh challenge requested')
    expect(fetcher.mock.calls[1][0]).toContain('/session/challenge')
  }
  expect(wallet.sign).not.toHaveBeenCalled()
})

it('M05: simultaneous readers share a request with independent cancellation',async()=>{
  let finish!:(response:Response)=>void
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',fetcher)
  const controller=new AbortController(),first=readSession(account,controller.signal),second=readSession(account)
  controller.abort();await expect(first).rejects.toThrow()
  finish(Response.json({session:null}));expect(await second).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
