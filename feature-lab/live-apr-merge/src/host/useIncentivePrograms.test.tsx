import {act,renderHook} from '@testing-library/react'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useIncentivePrograms} from './useIncentivePrograms'

const request=vi.hoisted(()=>vi.fn())
vi.mock('./transport',()=>({requestJson:request}))
const key='saffron.incentive-programs.v1:'+import.meta.env.BASE_URL
const offers=[{id:'one',active:true}],response={offers,creatorOnline:true}
beforeEach(()=>{
  sessionStorage.clear();request.mockReset();request.mockImplementation(()=>new Promise(()=>{}))
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
  JSON.stringify({at:Date.now()-300_001,offers}),JSON.stringify({at:Date.now()+60_000,offers}),
])('ignores unusable cached data: %s',saved=>{
  sessionStorage.setItem(key,saved)
  expect(renderHook(()=>useIncentivePrograms()).result.current).toMatchObject({offers:[],loading:true})
})

it('keeps cached offers and their original timestamp when refreshing fails',async()=>{
  const saved=JSON.stringify({at:Date.now()-1000,offers});sessionStorage.setItem(key,saved)
  request.mockRejectedValueOnce(Error('offline'))
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({offers,loading:false,error:'offline'})
  expect(sessionStorage.getItem(key)).toBe(saved)
})

it('a successful empty catalog replaces the snapshot instead of retaining old programs',async()=>{
  sessionStorage.setItem(key,JSON.stringify({at:Date.now(),offers}))
  request.mockResolvedValueOnce({offers:[],creatorOnline:true})
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({offers:[],loading:false})
  expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({offers:[]})
})

it('storage failures do not discard a successful response',async()=>{
  vi.spyOn(sessionStorage,'getItem').mockImplementation(()=>{throw Error('blocked')})
  vi.spyOn(sessionStorage,'setItem').mockImplementation(()=>{throw Error('quota')})
  request.mockResolvedValueOnce(response)
  const {result}=renderHook(()=>useIncentivePrograms());await act(async()=>{})
  expect(result.current).toMatchObject({...response,loading:false});expect(result.current.error).toBeUndefined()
})
