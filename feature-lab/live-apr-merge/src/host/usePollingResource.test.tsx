import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { usePollingResource } from './usePollingResource'
test('page restore refreshes retained data and disposal aborts reads',async()=>{
  let signal:AbortSignal|undefined
  const load=vi.fn(async(s:AbortSignal)=>{signal=s;return 'confirmed'})
  const {result,unmount}=renderHook(()=>usePollingResource('position',load))
  await waitFor(()=>expect(result.current.data).toBe('confirmed'))
  load.mockRejectedValueOnce(new Error('RPC unavailable'))
  act(()=>window.dispatchEvent(new Event('pageshow')))
  await waitFor(()=>expect(result.current.error).toBe('RPC unavailable'))
  expect(result.current.data).toBe('confirmed')
  act(()=>window.dispatchEvent(new Event('focus')))
  await waitFor(()=>expect(result.current.error).toBeUndefined())
  unmount();expect(signal?.aborted).toBe(true)
  const count=load.mock.calls.length;window.dispatchEvent(new Event('pageshow'))
  expect(load).toHaveBeenCalledTimes(count)
})

// Hidden route consumers must do no work, including focus-triggered polls.
test('disabled resources start only when enabled, then abort on disable',async()=>{
  let signal:AbortSignal|undefined
  const load=vi.fn(async(s:AbortSignal)=>{signal=s;return 'ready'})
  const {result,rerender}=renderHook(({enabled})=>usePollingResource('rows',load,'rows:updated',enabled),{initialProps:{enabled:false}})
  act(()=>window.dispatchEvent(new Event('focus')))
  expect(load).not.toHaveBeenCalled();expect(result.current.loading).toBe(false)
  rerender({enabled:true})
  await waitFor(()=>expect(result.current.data).toBe('ready'))
  rerender({enabled:false});expect(signal?.aborted).toBe(true)
  const count=load.mock.calls.length
  act(()=>{window.dispatchEvent(new Event('rows:updated'));window.dispatchEvent(new Event('pageshow'))})
  expect(load).toHaveBeenCalledTimes(count)
})

// M06: event bursts while an old read is pending must yield one fresh read.
test('coalesces invalidations and never publishes the pre-mutation snapshot',async()=>{
  let finish!:(value:string)=>void
  const load=vi.fn().mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve})).mockResolvedValue('new')
  const view=renderHook(()=>usePollingResource('mutation',load,'changed'))
  act(()=>{view.result.current.refresh();window.dispatchEvent(new Event('changed'));view.result.current.refresh()})
  expect(load).toHaveBeenCalledTimes(1)
  await act(async()=>{finish('old')})
  await waitFor(()=>expect(view.result.current.data).toBe('new'))
  expect(load).toHaveBeenCalledTimes(2)
  view.unmount()
})
