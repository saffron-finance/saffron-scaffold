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
