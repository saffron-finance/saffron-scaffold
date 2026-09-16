import {act,renderHook} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {readOfferPrice,useOfferPrice} from './useOfferPrice'
import type {Offer} from '../incentives/model'

const mocks=vi.hoisted(()=>({block:vi.fn(),read:vi.fn()}))
vi.mock('./transport',()=>({createPriceReadClient:()=>({getBlockNumber:mocks.block,readContract:mocks.read})}))
const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40)
let count=0,hidden=false,fetchPrice:ReturnType<typeof vi.fn>
const offer=()=>({chainId:4663,pool:'0x'+(++count).toString(16).padStart(40,'0'),pairRevision:1,
  token0:{address:a,decimals:18},token1:{address:b,decimals:18}} as Offer)
const signal=()=>new AbortController().signal
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T20:00:00Z'));hidden=false
  vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden)
  mocks.block.mockReset().mockResolvedValue(10n)
  mocks.read.mockReset().mockImplementation(async({functionName}:any)=>functionName==='slot0'?[2n**96n]:functionName==='token0'?a:b)
  fetchPrice=vi.fn(async()=>Response.json({success:true,data:{chainId:4663,tokenAddress:b,currency:'usd',price:1,timestamp:new Date().toISOString()}}))
  vi.stubGlobal('fetch',fetchPrice)
  // jsdom omits AbortSignal.any; retain real cancellation semantics in the test.
  if(!AbortSignal.any)vi.stubGlobal('AbortSignal',Object.assign(AbortSignal,{any:(signals:AbortSignal[])=>{
    const controller=new AbortController()
    for(const signal of signals){if(signal.aborted)controller.abort();else signal.addEventListener('abort',()=>controller.abort(),{once:true})}
    return controller.signal
  }}))
})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})

it('coalesces reopen/focus reads for two minutes and only rereads slot0 after warmup',async()=>{
  const o=offer()
  await Promise.all(Array.from({length:20},()=>readOfferPrice(o,signal())))
  expect(mocks.block).toHaveBeenCalledTimes(1);expect(mocks.read).toHaveBeenCalledTimes(3);expect(fetchPrice).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(119_999);await readOfferPrice(o,signal())
  expect(fetchPrice).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1);await readOfferPrice(o,signal())
  expect(mocks.block).toHaveBeenCalledTimes(2);expect(mocks.read).toHaveBeenCalledTimes(4);expect(fetchPrice).toHaveBeenCalledTimes(2)
  await readOfferPrice({...o,pairRevision:2},signal())
  expect(mocks.read).toHaveBeenCalledTimes(7)
})

it('does no hidden-tab polling and reuses fresh observations on focus/manual refresh',async()=>{
  const o=offer(),{result,unmount}=renderHook(()=>useOfferPrice(o))
  await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
  expect(result.current.value).toBeDefined();expect(fetchPrice).toHaveBeenCalledTimes(1)
  await act(async()=>{window.dispatchEvent(new Event('focus'));result.current.refresh();await vi.advanceTimersByTimeAsync(1)})
  expect(fetchPrice).toHaveBeenCalledTimes(1)
  hidden=true;await act(async()=>{await vi.advanceTimersByTimeAsync(240_000);window.dispatchEvent(new Event('focus'))})
  expect(fetchPrice).toHaveBeenCalledTimes(1)
  hidden=false;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(1)})
  expect(fetchPrice).toHaveBeenCalledTimes(2)
  unmount();await vi.advanceTimersByTimeAsync(300_000);expect(fetchPrice).toHaveBeenCalledTimes(2)
})

it('stops preview reads when preparation starts and resumes from the cache',async()=>{
  const o=offer(),{rerender,unmount}=renderHook(({selected}:{selected:Offer|null})=>useOfferPrice(selected),{initialProps:{selected:o as Offer|null}})
  await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
  rerender({selected:null});await act(async()=>{await vi.advanceTimersByTimeAsync(60_000)})
  rerender({selected:o});await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
  expect(fetchPrice).toHaveBeenCalledTimes(1);unmount()
})

it('backs off failed previews and rejects incorrect token identity instead of caching success',async()=>{
  const o=offer();fetchPrice.mockRejectedValueOnce(Error('outage'))
  await expect(readOfferPrice(o,signal())).rejects.toThrow('outage')
  await expect(readOfferPrice(o,signal())).rejects.toThrow('cooling down');expect(fetchPrice).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10_001);await readOfferPrice(o,signal());expect(fetchPrice).toHaveBeenCalledTimes(2)
  mocks.read.mockImplementation(async({functionName}:any)=>functionName==='slot0'?[2n**96n]:'0x'+'3'.repeat(40))
  await expect(readOfferPrice(offer(),signal())).rejects.toThrow('Pool token identity changed')
})

it('one cancelled consumer does not cancel a shared preview for another modal',async()=>{
  const o=offer(),controller=new AbortController()
  const closed=readOfferPrice(o,controller.signal),active=readOfferPrice(o,signal())
  controller.abort();await expect(closed).rejects.toThrow();expect(await active).toHaveProperty('quoteUsd',1)
  expect(fetchPrice).toHaveBeenCalledTimes(1)
})

// M07: even a transport fixture that ignores AbortSignal cannot hold callers.
it('settles shared preview at its deadline and never continues after a late block',async()=>{
  let resolve!:(block:bigint)=>void
  mocks.block.mockImplementation(()=>new Promise<bigint>(done=>{resolve=done}))
  const work=readOfferPrice(offer(),signal())
  const rejected=expect(work).rejects.toThrow(/timed out/)
  await vi.advanceTimersByTimeAsync(30_001);await rejected
  resolve(12n);await vi.advanceTimersByTimeAsync(0)
  expect(mocks.block).toHaveBeenCalledTimes(1)
  expect(mocks.read).not.toHaveBeenCalled();expect(fetchPrice).not.toHaveBeenCalled()
})
