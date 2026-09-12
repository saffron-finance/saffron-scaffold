import {
  Box3,
  Timer,
  Group,
  Mesh,
  MeshMatcapMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { EmblemError } from './emblemStatic'

/**
 * Standalone WebGL scene that renders the spinning 3D Saffron emblem.
 *
 * Ported from the marketing site's `Gl/atoms/SpinningModel` (saffron-website,
 * `assets/js/Gl/atoms/SpinningModel/index.js`) — the matcap material, the
 * blue-noise dither injected via `onBeforeCompile`, the base rotation and the
 * pointer tilt are all carried over verbatim. Everything that tied that class
 * to the marketing site is dropped: the shared GL store/renderer, the DOM
 * `Tracker`, Theatre.js debug bindings, Lenis scroll velocity, stencil section
 * masks and the ember particles. What's left owns its own renderer and camera,
 * so it drops into any host that can hand it a canvas.
 *
 * Deliberately framework-free — no React import — so the same file can back a
 * React, Vue or vanilla mount. `Emblem3D.tsx` is the React wrapper.
 */

export interface EmblemSceneOptions {
  /**
   * Element to render into. The scene creates, appends and later removes its
   * OWN canvas rather than adopting one from the host: two scenes sharing a
   * canvas would share its WebGL context, so the first one to be disposed
   * would tear the context out from under the second. React StrictMode's
   * double-invoked effects make that overlap the norm, not an edge case.
   */
  container: HTMLElement
  /** URL of the emblem .glb (single mesh, no DRACO/KTX). */
  modelUrl: string
  /** URL of the matcap texture — this is what gives the emblem its colour. */
  matcapUrl: string
  /** URL of a tiling blue-noise texture used for the dither. Optional. */
  noiseUrl?: string
  /** Spin rate around Y, in radians/second. */
  spinSpeed?: number
  /** How far the emblem leans toward the pointer, in radians at full deflection. */
  tiltStrength?: number
  /** Strength of the blue-noise darkening, 0–2. Matches the site's default. */
  noiseFactor?: number
  /** Extra scale applied on top of the fit-to-canvas scale. */
  scaleFactor?: number
  /**
   * Multiplier on the material's base colour. The marketing site uses 2, but
   * it also multiplies in a diffuse map that pulls the result back down; with
   * the matcap alone, 2 clips the emblem to white.
   */
  colorBoost?: number
  /** Called if the browser drops the WebGL context. */
  onContextLost?: () => void
}

const DEFAULTS = {
  spinSpeed: 0.25,
  tiltStrength: 0.3,
  // The site uses 0.8 on an emblem that fills a hero section; at logo scale a
  // dither that strong reads as dimming rather than texture.
  noiseFactor: 0.6,
  scaleFactor: 1,
  colorBoost: 1.5,
}

// Base pose from the marketing site's SpinningModel, which tips the emblem
// slightly so it never reads as a flat front-on silhouette.
const BASE_ROTATION_Z = 0.3
const BASE_ROTATION_Y = -0.1

// A narrow FOV keeps perspective distortion subtle at logo sizes while still
// giving the spin some depth. Distance is arbitrary — only the ratio matters,
// since the model is scaled to the resulting frustum.
const CAMERA_FOV = 30
const CAMERA_DISTANCE = 10

// Retina is worth it on a shape this small; beyond 2x is spend with no visible
// return.
const MAX_PIXEL_RATIO = 2

// Blue noise only dithers correctly at roughly one texel per device pixel — at
// any other rate it stops being blue noise and starts being a visible pattern.
// The site hardcodes `gl_FragCoord.xy * 0.005` against a 256px texture (≈1.28
// texels/px); deriving the factor from the actual texture size keeps that 1:1
// intent if the texture is ever swapped for a different resolution.
const noiseScaleFor = (texture: Texture) => {
  // Texture.image is `{}` in @types/three — it can be an ImageBitmap, a canvas
  // or a data object depending on the loader, so its size is read defensively.
  const image = texture.image as { width?: number } | undefined
  return 1 / (image?.width || 256)
}

const loadTexture = (loader: TextureLoader, url: string) =>
  new Promise<Texture>((resolve, reject) => {
    loader.load(url, resolve, undefined, () =>
      reject(new EmblemError('texture-load', `Failed to load texture ${url}`))
    )
  })

const loadModel = (loader: GLTFLoader, url: string) =>
  new Promise<Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => reject(new EmblemError('model-load', `Failed to load model ${url}`))
    )
  })

export class EmblemScene {
  /**
   * Builds the scene once its assets have loaded. Rejects if WebGL is
   * unavailable or an asset fails — callers should fall back to a flat logo.
   */
  static async create(options: EmblemSceneOptions): Promise<EmblemScene> {
    const textureLoader = new TextureLoader()
    const [model, matcap, noise] = await Promise.all([
      loadModel(new GLTFLoader(), options.modelUrl),
      loadTexture(textureLoader, options.matcapUrl),
      options.noiseUrl ? loadTexture(textureLoader, options.noiseUrl) : Promise.resolve(undefined),
    ])

    return new EmblemScene(options, model, matcap, noise)
  }

  private readonly options: Required<Omit<EmblemSceneOptions, 'noiseUrl' | 'onContextLost'>> &
    Pick<EmblemSceneOptions, 'noiseUrl' | 'onContextLost'>

  private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  /**
   * Timer, not Clock: Clock is deprecated in the three we pin and warned on
   * every page load. `update()` runs once per frame immediately before
   * `getDelta()`, which is exactly when Clock recomputed its own delta.
   *
   * `connect(document)` opts into the Page Visibility API, so the delta is
   * ZERO while the tab is hidden instead of covering the whole time away. The
   * emblem then resumes exactly where it left off rather than jumping forward
   * — the case the clamp in `update()` was blunting. The clamp stays as the
   * backstop for everything else that can stall a frame (a long task, a
   * throttled background rAF, a sleeping machine).
   *
   * Connected once in the constructor and released in dispose() — see both for
   * why it can't be done per start().
   */
  private readonly timer = new Timer()

  /** Spins around Y; carries the emblem's base pose. */
  private readonly modelGroup = new Group()
  /** Wraps the model group so pointer tilt composes on top of the spin. */
  private readonly tiltGroup = new Group()

  private readonly material: MeshMatcapMaterial
  private readonly matcap: Texture
  private readonly noise?: Texture
  private readonly uniforms: {
    uNoiseTxt: { value: Texture | null }
    uNoiseScale: { value: number }
    uNoiseFactor: { value: number }
  }

  /** Worst-case XY footprint of the emblem across a full spin — the fit box. */
  private readonly fitWidth: number
  private readonly fitHeight: number

  private readonly pointer = { x: 0, y: 0 }
  private readonly pointerSmooth = { x: 0, y: 0 }

  private frameId = 0
  private disposed = false

  private constructor(
    options: EmblemSceneOptions,
    model: Group,
    matcap: Texture,
    noise: Texture | undefined
  ) {
    // Coalesced per key rather than spread over DEFAULTS: React callers pass
    // optional props straight through, and an explicit `undefined` in a spread
    // would clobber the default instead of falling back to it.
    this.options = {
      ...options,
      spinSpeed: options.spinSpeed ?? DEFAULTS.spinSpeed,
      tiltStrength: options.tiltStrength ?? DEFAULTS.tiltStrength,
      noiseFactor: options.noiseFactor ?? DEFAULTS.noiseFactor,
      scaleFactor: options.scaleFactor ?? DEFAULTS.scaleFactor,
      colorBoost: options.colorBoost ?? DEFAULTS.colorBoost,
    }
    this.matcap = matcap
    this.noise = noise

    // Once, here — NOT in start(). Timer.connect() binds a fresh handler and
    // addEventListener's it on every call while only remembering the last one,
    // so calling it per start() would leak a listener on each stop/start cycle
    // (routine here — the emblem stops when scrolled out of view) and
    // disconnect() would remove only one of them.
    this.timer.connect(document)

    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    options.container.appendChild(this.canvas)

    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        // The logo is composited over the page, so nothing ever reads it back.
        powerPreference: 'low-power',
      })
    } catch (cause) {
      // three throws here when the browser won't hand out a context at all:
      // hardware acceleration switched off, a blocklisted GPU, or the per-tab
      // live-context cap already reached. Take the canvas back out so a failed
      // create() leaves the host exactly as it found it.
      this.canvas.remove()
      throw new EmblemError('webgl-unavailable', 'Could not create a WebGL context', { cause })
    }
    this.renderer.setClearAlpha(0)

    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
    this.camera.position.z = CAMERA_DISTANCE

    matcap.colorSpace = SRGBColorSpace
    this.uniforms = {
      uNoiseTxt: { value: null },
      uNoiseScale: { value: 0 },
      uNoiseFactor: { value: this.options.noiseFactor },
    }

    if (noise) {
      // Tiles across the canvas in screen space, so it must repeat.
      noise.wrapS = RepeatWrapping
      noise.wrapT = RepeatWrapping
      this.uniforms.uNoiseTxt.value = noise
      this.uniforms.uNoiseScale.value = noiseScaleFor(noise)
    }

    this.material = new MeshMatcapMaterial({ matcap, transparent: true })
    this.material.color.multiplyScalar(this.options.colorBoost)

    if (noise) {
      this.material.onBeforeCompile = (shader) => {
        shader.uniforms = { ...shader.uniforms, ...this.uniforms }

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          /* glsl */ `
            uniform float uNoiseFactor;
            uniform float uNoiseScale;
            uniform sampler2D uNoiseTxt;
            #include <common>
          `
        )

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          /* glsl */ `
            float bn = texture(uNoiseTxt, gl_FragCoord.xy * uNoiseScale).r;
            outgoingLight.rgb *= 1.0 - bn * uNoiseFactor;
            outgoingLight.rgb = clamp(outgoingLight.rgb, 0.0, 3.0);
            #include <opaque_fragment>
          `
        )
      }
    }

    model.traverse((child) => {
      if ((child as Mesh).isMesh) (child as Mesh).material = this.material
    })

    // Centre the emblem on its own bounds so it spins about itself rather than
    // about whatever origin the GLB happened to be exported with.
    const bounds = new Box3().setFromObject(model)
    const size = bounds.getSize(new Vector3())
    const centre = bounds.getCenter(new Vector3())
    model.position.sub(centre)

    // Fit box: the largest AABB the emblem occupies at ANY point in its spin,
    // so it never clips mid-rotation. Spinning about Y sweeps the X extent
    // between size.x and size.z (max footprint √(x²+z²)); the fixed Z tilt then
    // rotates that box, growing both axes.
    const swept = Math.hypot(size.x, size.z)
    const cos = Math.abs(Math.cos(BASE_ROTATION_Z))
    const sin = Math.abs(Math.sin(BASE_ROTATION_Z))
    this.fitWidth = swept * cos + size.y * sin
    this.fitHeight = swept * sin + size.y * cos

    this.modelGroup.add(model)
    this.modelGroup.rotation.order = 'ZXY'
    this.modelGroup.rotation.z = BASE_ROTATION_Z
    this.modelGroup.rotation.y = BASE_ROTATION_Y

    this.tiltGroup.rotation.order = 'XYZ'
    this.tiltGroup.add(this.modelGroup)
    this.scene.add(this.tiltGroup)

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost)
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault()
    this.stop()
    this.options.onContextLost?.()
  }

  /** Resize to a CSS-pixel box and refit the emblem inside it. */
  setSize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.renderer.setSize(width, height, false)

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    // World-space extent of the frustum at the emblem's depth.
    const visibleHeight =
      2 * CAMERA_DISTANCE * Math.tan((CAMERA_FOV * Math.PI) / 180 / 2)
    const visibleWidth = visibleHeight * this.camera.aspect

    const scale =
      Math.min(visibleWidth / this.fitWidth, visibleHeight / this.fitHeight) *
      this.options.scaleFactor
    this.modelGroup.scale.setScalar(scale)
  }

  /** Pointer position, normalised to -1…1 on each axis. */
  setPointer(x: number, y: number) {
    this.pointer.x = x
    this.pointer.y = y
  }

  /** Renders a single frame — used for the reduced-motion still. */
  renderFrame() {
    if (this.disposed) return
    this.renderer.render(this.scene, this.camera)
  }

  setSpinSpeed(speed?: number) { this.options.spinSpeed = speed ?? DEFAULTS.spinSpeed }

  start() {
    if (this.disposed || this.frameId) return
    this.timer.reset() // drop the idle time accumulated since the last stop
    const tick = () => {
      this.frameId = requestAnimationFrame(tick)
      this.update()
      this.renderFrame()
    }
    this.frameId = requestAnimationFrame(tick)
  }

  stop() {
    if (!this.frameId) return
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
  }

  private update() {
    // Clamped so a long background tab doesn't resume with one huge jump.
    this.timer.update()
    const delta = Math.min(this.timer.getDelta(), 0.1)

    // Frame-rate-independent smoothing toward the pointer.
    const ease = 1 - Math.exp(-delta * 6)
    this.pointerSmooth.x += (this.pointer.x - this.pointerSmooth.x) * ease
    this.pointerSmooth.y += (this.pointer.y - this.pointerSmooth.y) * ease

    const { tiltStrength, spinSpeed } = this.options
    this.tiltGroup.rotation.x = this.pointerSmooth.y * tiltStrength
    this.tiltGroup.rotation.y = this.pointerSmooth.x * tiltStrength
    this.modelGroup.rotation.y += spinSpeed * delta
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    // Drops the visibilitychange listener connect() added; without it the
    // document keeps a reference to this scene after the emblem unmounts.
    this.timer.dispose()

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)

    this.scene.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) mesh.geometry?.dispose()
    })
    this.material.dispose()
    this.matcap.dispose()
    this.noise?.dispose()

    this.renderer.dispose()
    // Frees the GPU context immediately rather than waiting on GC — the nav
    // logo can mount and unmount repeatedly and browsers cap live contexts.
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }
}
