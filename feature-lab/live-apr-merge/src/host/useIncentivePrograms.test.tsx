import {act,cleanup,renderHook} from '@testing-library/react'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useIncentivePrograms} from './useIncentivePrograms'

const request=vi.hoisted(()=>vi.fn())
vi.mock('./transport',()=>({requestJson:request}))
const key='saffron.incentive-programs.v2:'+import.meta.env.BASE_URL
const offers=[{id:'one',pairId:'pair',active:true,apr:20,days:30,availability:null,budget:{paused:false},token0:{address:'0x1',symbol:'A',decimals:18},token1:{address:'0x2',symbol:'B',decimals:18}}],response={offers,creatorOnline:true}
beforeEach(()=>{
  localStorage.clear();request.mockReset();request.mockImplementation(()=>new Promise(()=>{}))
  vi.spyOn(document,'hidden','get').mockReturnValue(false)
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})

it('paints cached offers synchronously on remount while revalidating availability',async()=>{
  request.mockResolvedValueOnce(response)
  const first=renderHook(()=>useIncentivePrograms())
  expect(first.result.current).toMatchObject({offers:[],loading:true})
  await act(async()=>{})
  expect(first.result.current).toMatchObject({...response,loading:false})
  first.unmount()
  const second=renderHook(()=>useIncentivePrograms())
  expect(second.result.current).toMatchObject({offers,loading:true})
  expect(request).toHaveBeenCalledTimes(2)
})

it.each([
  'broken JSON',JSON.stringify({at:Date.now(),offers:null}),
  JSON.stringify({at:Date.now()-300_001,offers}),JSON.stringify({at:Date.now()+60_000,offers}),JSON.stringify({at:Date.now(),offers:[{id:'bad'}]}),
  JSON.stringify({at:String(Date.now()),offers}),JSON.stringify({at:Date.now(),offers:[{...offers[0],token0:null}]}),
])('ignores unusable cached data: %s',saved=>{
  localStorage.setItem(key,saved)
  expect(renderHook(()=>useIncentivePrograms()).result.current).toMatchObject({offers:[],loading:true})
})

it('keeps cached offers and their original timestamp when refreshing fails',async()=>{
  const saved=JSON.stringify({at:Date.now()-1000,offers});localStorage.setItem(key,saved)
  request.mockRejectedValueOnce(Error('offline'))
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({offers,loading:false,error:'offline'})
  expect(localStorage.getItem(key)).toBe(saved)
})

it('a successful empty catalog replaces the snapshot instead of retaining old programs',async()=>{
  localStorage.setItem(key,JSON.stringify({at:Date.now(),offers}))
  request.mockResolvedValueOnce({offers:[],creatorOnline:true})
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({offers:[],loading:false})
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({offers:[]})
})

it('storage failures do not discard a successful response',async()=>{
  vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw Error('blocked')})
  vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('quota')})
  request.mockResolvedValueOnce(response)
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({...response,loading:false});expect(result.current.error).toBeUndefined()
})

it('recognizes a saved empty catalog without resurrecting loading rows',()=>{
  localStorage.setItem(key,JSON.stringify({at:Date.now(),offers:[]}))
  expect(renderHook(()=>useIncentivePrograms()).result.current).toMatchObject({offers:[],loading:true,hasSnapshot:true})
})

it('clearing browser storage restores the cold path',()=>{
  localStorage.setItem(key,JSON.stringify({at:Date.now(),offers}))
  localStorage.clear()
  expect(renderHook(()=>useIncentivePrograms()).result.current).toMatchObject({offers:[],hasSnapshot:false})
})

it('restores Back/Forward pixels but revokes action authority until a new response',async()=>{
  request.mockResolvedValueOnce(response)
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current.canAct()).toBe(true)
  // Even a previously captured handler sees synchronous revocation.
  const previousCanAct=result.current.canAct
  act(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})))
  expect(previousCanAct()).toBe(false)
  expect(result.current).toMatchObject({offers,loading:true})
  act(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  expect(request).toHaveBeenCalledTimes(2)
  expect(result.current.canAct()).toBe(false)
})

it('ignores a pre-freeze response which arrives after a restored-page refresh',async()=>{
  let oldReply!:(value:unknown)=>void,newReply!:(value:unknown)=>void
  request.mockImplementationOnce(()=>new Promise(resolve=>{oldReply=resolve}))
    .mockImplementationOnce(()=>new Promise(resolve=>{newReply=resolve}))
  const {result}=renderHook(()=>useIncentivePrograms())
  act(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})))
  act(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  await act(async()=>{newReply({...response,offers:[]})})
  expect(result.current.canAct()).toBe(true)
  await act(async()=>{oldReply(response)})
  expect(result.current.offers).toEqual([])
})

// An accepted edit arriving during a poll must get one fresh post-edit read.
it('queues catalog invalidation behind an active poll and discards its pre-edit result',async()=>{
  let oldReply!:(v:unknown)=>void
  request.mockImplementationOnce(()=>new Promise(resolve=>{oldReply=resolve})).mockResolvedValueOnce({...response,offers:[]})
  const {result}=renderHook(()=>useIncentivePrograms())
  act(()=>{result.current.refresh();result.current.refresh()})
  expect(request).toHaveBeenCalledTimes(1)
  await act(async()=>{oldReply(response)})
  expect(request).toHaveBeenCalledTimes(2)
  expect(result.current.offers).toEqual([])
})
