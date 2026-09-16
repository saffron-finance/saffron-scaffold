import { afterEach, expect, it, vi } from 'vitest'
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Texture, TextureLoader, Timer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EmblemScene } from '../../vendor/fixed-income-ui/shared/components/emblem3d/EmblemScene'

// A blocked GPU is a normal fallback path, not a reason to retain its assets.
vi.mock('three', async importOriginal => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class { constructor() { throw new Error('GPU unavailable') } },
}))
afterEach(() => vi.restoreAllMocks())

it('disposes assets arriving after cancellation without constructing a scene', async () => {
  const controller = new AbortController(), model = new Group()
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), texture = new Texture()
  model.add(new Mesh(geometry, material))
  const disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeTexture = vi.spyOn(texture, 'dispose')
  let deliverModel: (value: any) => void, deliverTexture: ((value: Texture) => void) | undefined
  vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((_url, done) => { deliverModel = done })
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, done) => { deliverTexture = done; return texture })
  const container = document.createElement('div')
  const loading = EmblemScene.create({ container, signal: controller.signal, modelUrl: '/logo.glb', matcapUrl: '/matcap.jpg' })
  controller.abort()
  await expect(loading).rejects.toThrow()
  deliverModel!({ scene: model }); deliverTexture!(texture)
  await Promise.resolve()
  expect(disposeGeometry).toHaveBeenCalledOnce()
  expect(disposeTexture).toHaveBeenCalledOnce()
  expect(container.childElementCount).toBe(0)
})

it('releases loaded geometry/textures and never retains a Timer listener when WebGL fails', async () => {
  const model = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial()
  model.add(new Mesh(geometry, material))
  const texture = new Texture(), disposed = vi.spyOn(texture, 'dispose')
  const disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeMaterial = vi.spyOn(material, 'dispose')
  const connect = vi.spyOn(Timer.prototype, 'connect')
  vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((_url, done) => { done({ scene: model } as any) })
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, done) => { done?.(texture); return texture })
  const container = document.createElement('div')
  await expect(EmblemScene.create({ container, modelUrl: '/logo.glb', matcapUrl: '/matcap.jpg' })).rejects.toThrow('WebGL')
  expect(connect).not.toHaveBeenCalled()
  expect(disposed).toHaveBeenCalledOnce()
  expect(disposeGeometry).toHaveBeenCalledOnce()
  expect(disposeMaterial).toHaveBeenCalledOnce()
  expect(container.childElementCount).toBe(0)
})
