import {act,cleanup,render} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
const model=vi.hoisted(()=>({render:vi.fn(),dispose:vi.fn(),resize:vi.fn(),size:vi.fn(),disconnect:vi.fn()}))
vi.mock('../../vendor/fixed-income-ui/shared/components/emblem3d/EmblemScene',()=>({EmblemScene:{create:async()=>({setSize:model.size,renderFrame:model.render,dispose:model.dispose,setSpinSpeed:vi.fn()})}}))
import {Emblem3D} from '../../vendor/fixed-income-ui/shared/components/emblem3d/Emblem3D'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('N028: reduced-motion resize failures notify fallback once and dispose immediately',async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true}))
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){model.resize.mockImplementation(callback)}observe(){}disconnect(){model.disconnect()}})
  const onError=vi.fn(),onReady=vi.fn()
  const view=render(<Emblem3D modelUrl='/logo' matcapUrl='/texture' onError={onError} onReady={onReady}/>)
  await act(async()=>{})
  expect(onReady).toHaveBeenCalledOnce()
  model.render.mockImplementation(()=>{throw Error('GPU failure')})
  act(()=>{model.resize();model.resize();model.resize()})
  expect(onError).toHaveBeenCalledOnce();expect(model.dispose).toHaveBeenCalledOnce();expect(model.disconnect).toHaveBeenCalledOnce()
  view.unmount()
})
