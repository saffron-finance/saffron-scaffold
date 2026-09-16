import {act,cleanup,renderHook} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {useFixedRanges} from './useFixedRanges'
const load=vi.hoisted(()=>vi.fn())
vi.mock('./fixedRange',()=>({loadFixedRanges:load}))
afterEach(()=>{cleanup();vi.useRealTimers();load.mockReset()})
it.each(['omitted','rejected'])('N032 %s ranges do not loop and only explicitly retry after cooldown',async mode=>{
  vi.useFakeTimers()
  load.mockImplementation(()=>mode==='omitted'?Promise.resolve(new Map()):Promise.reject(Error('offline')))
  const vaults=[{vault:'0x123',chainKey:'ethereum'}] as any
  const {result,rerender}=renderHook(()=>useFixedRanges(vaults,true))
  const initial=result.current.ranges
  await act(async()=>{});expect(load).toHaveBeenCalledTimes(1);expect(result.current.unavailable).toBe(1)
  for(let i=0;i<10;i++)rerender()
  await act(async()=>vi.advanceTimersByTimeAsync(120000))
  expect(load).toHaveBeenCalledTimes(1);expect(result.current.ranges).toBe(initial)
  act(()=>result.current.retry());await act(async()=>{})
  expect(load).toHaveBeenCalledTimes(2)
  act(()=>result.current.retry());expect(load).toHaveBeenCalledTimes(2)
})
