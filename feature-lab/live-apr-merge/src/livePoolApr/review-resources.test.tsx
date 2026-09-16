import {act,cleanup,renderHook} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {SummaryClient} from './summary-client'
import {validSnapshot} from './contracts'
import {formatTimestamp} from './time'
import {fixtureBaseline,fixtureSnapshot,watcher} from './testing/summary-fixtures'
import {usePoolHistory} from './usePoolHistory'
afterEach(()=>{cleanup();vi.useRealTimers();sessionStorage.clear()})

it.each([503,200])('N025: aborts and cancels each rejected HTTP %s stream before retry',async status=>{
  vi.useFakeTimers();vi.setSystemTime(60_000)
  let open=0,attempts=0;const signals:AbortSignal[]=[]
  const receipt={sessionId:'s',loadId:'l',poolId:'cashcat-eth-1',acceptedAtMs:1000,joinAtMs:1000,baseline:fixtureBaseline(),watcher,loadDeadlineMs:watcher.loadDeadlineMs,serverTimeMs:60_000}
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(String(input).endsWith('/events')){
      open++;attempts++;signals.push(init!.signal as AbortSignal)
      return new Response(new ReadableStream({cancel(){open--}}),{status,headers:{'content-type':'application/json'}})
    }
    return Response.json(receipt)
  }) as typeof fetch
  const client=new SummaryClient('cashcat-eth-1',{api:'/test',loadId:'l',fetcher})
  client.start();await vi.advanceTimersByTimeAsync(20_000)
  expect(attempts).toBeGreaterThan(2);expect(open).toBe(0)
  expect(signals.every(s=>s.aborted)).toBe(true)
  client.stop();expect(open).toBe(0)
})

it('N033: rejects every out-of-Date-range timestamp and formats bad legacy values safely',()=>{
  for(const key of ['chainTimeMs','headSelectedAtMs','committedAtMs']){
    const snapshot=fixtureSnapshot();(snapshot.coverage as any)[key]=Number.MAX_SAFE_INTEGER
    expect(validSnapshot(snapshot,snapshot.poolId)).toBe(false)
  }
  const last=fixtureSnapshot(2);last.lastSwap!.chainTimeMs=Number.MAX_SAFE_INTEGER
  expect(validSnapshot(last,last.poolId)).toBe(false)
  expect(formatTimestamp(Number.MAX_SAFE_INTEGER)).toBe('Unavailable')
  expect(formatTimestamp(8640000000000000)).toContain('275760')
})

it('M09: paused history is not busy and its late result cannot publish',async()=>{
  let finish!:(value:any)=>void,signal:AbortSignal|undefined
  const client={state:{summary:{}},history:vi.fn((_cursor:any,s:AbortSignal)=>{signal=s;return new Promise(resolve=>{finish=resolve})})}
  const model={client,baseline:fixtureBaseline(),paused:false,valuationUnavailable:false} as any
  const view=renderHook(({paused})=>usePoolHistory({...model,paused},false),{initialProps:{paused:false}})
  act(()=>view.result.current.setHistoryOpen(true))
  expect(view.result.current.historyBusy).toBe(true)
  view.rerender({paused:true});expect(signal?.aborted).toBe(true);expect(view.result.current.historyBusy).toBe(false)
  await act(async()=>{finish({epoch:'1',rows:[]})})
  expect(view.result.current.history).toBeNull();expect(view.result.current.historyBusy).toBe(false)
})
