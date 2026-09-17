import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Texture, Timer, Box3, MeshMatcapMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EmblemScene } from '../../vendor/fixed-income-ui/shared/components/emblem3d/EmblemScene'
const renderer = vi.hoisted(() => ({ fail: 'constructor', dispose: vi.fn(), lose: vi.fn() }))
const transport=vi.hoisted(()=>({bytes:vi.fn(),texture:vi.fn()}))
vi.mock('../../vendor/fixed-income-ui/shared/components/emblem3d/emblemTransport',()=>({loadEmblemBytes:transport.bytes,loadEmblemTexture:transport.texture}))

// A blocked GPU is a normal fallback path, not a reason to retain its assets.
vi.mock('three', async importOriginal => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    constructor() { if (renderer.fail === 'constructor') throw new Error('GPU unavailable') }
    setClearAlpha() { if (renderer.fail === 'clear') throw new Error('Context lost during setup') }
    dispose = renderer.dispose
    forceContextLoss = renderer.lose
  },
}))
afterEach(() => vi.restoreAllMocks())
beforeEach(()=>{renderer.fail='constructor';renderer.dispose.mockClear();renderer.lose.mockClear();transport.bytes.mockReset().mockResolvedValue(new ArrayBuffer(0));transport.texture.mockReset()})

it('disposes assets arriving after cancellation without constructing a scene', async () => {
  const controller = new AbortController(), model = new Group()
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), texture = new Texture()
  model.add(new Mesh(geometry, material))
  const disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeTexture = vi.spyOn(texture, 'dispose')
  let deliverModel: (value: any) => void, deliverTexture: ((value: Texture) => void) | undefined
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => { deliverModel = done })
  transport.texture.mockImplementation(()=>new Promise(resolve=>{deliverTexture=resolve}))
  const container = document.createElement('div')
  const loading = EmblemScene.create({ container, signal: controller.signal, modelUrl: '/logo.glb', matcapUrl: '/matcap.jpg' })
  await Promise.resolve() // Let the decoded model acquire its controlled parser callback.
  controller.abort()
  await expect(loading).rejects.toThrow()
  deliverModel!({ scene: model }); deliverTexture!(texture)
  await vi.waitFor(()=>expect(disposeGeometry).toHaveBeenCalledOnce())
  expect(disposeTexture).toHaveBeenCalledOnce()
  expect(container.childElementCount).toBe(0)
})

it('releases loaded geometry/textures and never retains a Timer listener when WebGL fails', async () => {
  const model = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial()
  model.add(new Mesh(geometry, material))
  const texture = new Texture(), disposed = vi.spyOn(texture, 'dispose')
  const disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeMaterial = vi.spyOn(material, 'dispose')
  const connect = vi.spyOn(Timer.prototype, 'connect')
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => { done({ scene: model } as any) })
  transport.texture.mockResolvedValue(texture)
  const container = document.createElement('div')
  await expect(EmblemScene.create({ container, modelUrl: '/logo.glb', matcapUrl: '/matcap.jpg' })).rejects.toThrow('WebGL')
  expect(connect).not.toHaveBeenCalled()
  expect(disposed).toHaveBeenCalledOnce()
  expect(disposeGeometry).toHaveBeenCalledOnce()
  expect(disposeMaterial).toHaveBeenCalledOnce()
  expect(container.childElementCount).toBe(0)
})

// These failure points straddle material replacement and listener registration.
// They verify ownership rather than merely checking that construction rejects.
it.each(['clear', 'bounds', 'timer'])('reclaims every constructor-owned resource after %s setup fails', async stage => {
  renderer.fail = stage
  const container = document.createElement('div'), model = new Group()
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), texture = new Texture()
  model.add(new Mesh(geometry, material))
  const geometryDispose = vi.spyOn(geometry, 'dispose'), originalDispose = vi.spyOn(material, 'dispose')
  const textureDispose = vi.spyOn(texture, 'dispose'), replacementDispose = vi.spyOn(MeshMatcapMaterial.prototype, 'dispose')
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, _path, done) => done({ scene: model } as any))
  transport.texture.mockResolvedValue(texture)
  if (stage === 'bounds') vi.spyOn(Box3.prototype, 'setFromObject').mockImplementation(() => { throw Error('bounds failed') })
  if (stage === 'timer') vi.spyOn(Timer.prototype, 'connect').mockImplementation(() => { throw Error('listener setup failed') })
  await expect(EmblemScene.create({ container, modelUrl: '/model.glb', matcapUrl: '/matcap.png' })).rejects.toThrow('initialize')
  expect(renderer.dispose).toHaveBeenCalledOnce()
  expect(renderer.lose).toHaveBeenCalledOnce()
  expect(geometryDispose).toHaveBeenCalledOnce()
  expect(originalDispose).toHaveBeenCalledOnce()
  expect(textureDispose).toHaveBeenCalledOnce()
  expect(replacementDispose).toHaveBeenCalledTimes(stage === 'clear' ? 0 : 1)
  expect(container.childElementCount).toBe(0)
})
