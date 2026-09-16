import {act,renderHook} from '@testing-library/react'
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
afterEach(()=>vi.restoreAllMocks())

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
