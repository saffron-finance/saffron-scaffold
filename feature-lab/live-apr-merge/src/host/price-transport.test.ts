import {afterEach,expect,it,vi} from 'vitest'
import {createPriceReadClient,robinhoodClient} from './transport'
afterEach(()=>vi.unstubAllGlobals())

it('M07 actual viem HTTP requests abort per preview, never join another owner or retry',async()=>{
  // jsdom's AbortSignal is not Node Undici's brand. This unused Request
  // constructor is an environment shim; viem and its actual fetch init remain real.
  vi.stubGlobal('Request',class { constructor(_url:string,_options:unknown){} })
  const requests:{body:any;signal:AbortSignal;resolve:(v:Response)=>void}[]=[]
  vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((resolve,reject)=>{
    requests.push({body:JSON.parse(options.body),signal:options.signal,resolve})
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})
  })))
  const a=new AbortController(),b=new AbortController()
  const first=createPriceReadClient(a.signal).getBlockNumber({cacheTime:0}).catch(()=>null)
  const second=createPriceReadClient(b.signal).getBlockNumber({cacheTime:0})
  const background=robinhoodClient.getBlockNumber({cacheTime:0})
  await vi.waitFor(()=>expect(requests.length).toBe(3))
  expect(requests.filter(r=>r.signal===a.signal)).toHaveLength(1)
  a.abort();expect(await first).toBeNull()
  for(const request of requests.filter(r=>r.signal!==a.signal)){
    expect(request.signal.aborted).toBe(false)
    const result=(body:any)=>({jsonrpc:'2.0',id:body.id,result:'0x10'})
    request.resolve(Response.json(Array.isArray(request.body)?request.body.map(result):result(request.body)))
  }
  expect(await second).toBe(16n);expect(await background).toBe(16n)
  await new Promise(r=>setTimeout(r,30));expect(requests.length).toBe(3)
})
