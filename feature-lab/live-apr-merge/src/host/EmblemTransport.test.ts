import { afterEach, expect, it, vi } from 'vitest'
import { loadEmblemBytes, loadEmblemTexture } from '../../vendor/fixed-income-ui/shared/components/emblem3d/emblemTransport'
import { EmblemScene } from '../../vendor/fixed-income-ui/shared/components/emblem3d/EmblemScene'

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})

it('FE-BOOT-021 failed texture load aborts sibling model and texture fetch owners',async()=>{
  const signals:AbortSignal[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
    signals.push(options.signal!)
    if(url==='/texture')return new Response('',{status:404})
    return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}))
  }))
  await expect(EmblemScene.create({container:document.createElement('div'),modelUrl:'/model',matcapUrl:'/texture',noiseUrl:'/noise'})).rejects.toThrow()
  expect(signals).toHaveLength(3);expect(signals.every(s=>s.aborted)).toBe(true)
})
it('FE-BOOT-022 model setup deadline revokes actual fetch signals rather than abandoning callbacks',async()=>{
  vi.useFakeTimers();const signals:AbortSignal[]=[]
  vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{
    signals.push(options.signal!)
    return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}))
  }))
  const loading=EmblemScene.create({container:document.createElement('div'),modelUrl:'/model',matcapUrl:'/texture'})
  const rejected=expect(loading).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(15_000);await rejected
  expect(signals.every(s=>s.aborted)).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
it('FE-BOOT-023 scene owner abort revokes every pending decorative fetch',async()=>{
  const owner=new AbortController(),signals:AbortSignal[]=[]
  vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{
    signals.push(options.signal!)
    return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}))
  }))
  const loading=EmblemScene.create({container:document.createElement('div'),modelUrl:'/model',matcapUrl:'/texture',signal:owner.signal})
  const rejected=expect(loading).rejects.toThrow();owner.abort();await rejected
  expect(signals).toHaveLength(2);expect(signals.every(s=>s.aborted)).toBe(true)
})
it('oversized chunked decorative assets are cancelled before image/model decoding',async()=>{
  const cancel=vi.fn()
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4_000_001))},cancel}))))
  await expect(loadEmblemBytes('/model',new AbortController().signal)).rejects.toThrow('too large')
  expect(cancel).toHaveBeenCalledOnce()
})
it('a bitmap decoded after cancellation closes CPU storage without publishing a texture',async()=>{
  const close=vi.fn(),owner=new AbortController();let deliver!:(value:ImageBitmap)=>void
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2]))))
  vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{deliver=resolve})))
  const loading=loadEmblemTexture('/texture',owner.signal),rejected=expect(loading).rejects.toThrow()
  await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'))
  owner.abort();deliver({close} as unknown as ImageBitmap);await rejected
  expect(close).toHaveBeenCalledOnce()
})
it('disposing a successfully decoded texture closes its separately owned bitmap',async()=>{
  const close=vi.fn()
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2]))))
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({close})))
  const texture=await loadEmblemTexture('/texture',new AbortController().signal)
  expect(close).not.toHaveBeenCalled();texture.dispose();expect(close).toHaveBeenCalledOnce()
})
