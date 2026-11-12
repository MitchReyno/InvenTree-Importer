import {
  Euler,
  Fog,
  Group,
  LineSegments,
  Mesh,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { partBuilders, pickPartType } from './catalogue'
import { FINISHES, type ThemeId } from './finishes'
import {
  applyStir,
  flowTarget,
  relaxTowards,
  separate,
  stirFalloff,
  type FlowBody,
  type PointerFlow,
} from './flow'
import { createOutlineKit, type OutlineKit } from './outline-kit'
import type { PartModel } from './part-model'
import { updateDisplay } from './parts/displays'

export interface ElectronicsCurrentOptions {
  reducedMotion: boolean
  theme?: ThemeId
  random?: () => number
}

export interface ElectronicsCurrentController {
  /** Pointer position in viewport (client) coordinates; ignored outside the canvas. */
  setPointer: (clientX: number, clientY: number) => void
  clearPointer: () => void
  /** Re-tints parts and fog for the theme without rebuilding them. */
  setTheme: (theme: ThemeId) => void
  dispose: () => void
}

// Scene units per CSS pixel; parts are modelled at roughly real proportions.
const UNITS_PER_PX = 0.17

const CAMERA_DISTANCE = 100

// About 30 parts across a 1280 px masthead; narrower screens get proportionally fewer.
const REFERENCE_WIDTH_PX = 1280

const PARTS_AT_REFERENCE_WIDTH = 30

const MIN_PARTS = 6

const MAX_PARTS = 40

// Parts enter and leave this far beyond the visible edges, in scene units.
const EDGE_MARGIN = 15

const MAX_FRAME_SECONDS = 0.05

const MAX_SPIN = 6

const POINTER_SPEED_DECAY = 5

interface LivePart {
  model: PartModel
  object: Group
  body: FlowBody
  spin: Vector3
  disturbance: Quaternion
  yaw: number
  yawRate: number
  placed: boolean
}

interface PointerState {
  active: boolean
  x: number
  y: number
  velocityX: number
  velocityY: number
  lastMoveAt: number
}

interface CameraAxes {
  right: Vector3
  up: Vector3
  back: Vector3
}

function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer | null {
  try {
    return new WebGLRenderer({ canvas, antialias: true, alpha: true })
  } catch {
    // No WebGL (old browser, disabled GPU, jsdom): the masthead stays plain text.
    return null
  }
}

/** True isometric view: orthographic camera looking down the (1, 1, 1) diagonal. */
function createIsometricCamera(): { camera: OrthographicCamera; axes: CameraAxes } {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 300)
  camera.position.set(1, 1, 1).normalize().multiplyScalar(CAMERA_DISTANCE)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const axes = {
    right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    back: new Vector3().setFromMatrixColumn(camera.matrixWorld, 2),
  }

  return { camera, axes }
}

// Loose ends hang in world space, so they live in one layer beside the parts.
export const HANGING_LAYER_NAME = 'hanging'

function disposePartObject(part: LivePart): void {
  part.object.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose()
    }
  })
  part.model.led?.dispose()
  part.model.hanging?.dispose()
}

/** Pulse an LED's fill towards its colour and brighten its glow in time. */
function pulseLed(part: LivePart, kit: OutlineKit, time: number): void {
  const led = part.model.led

  if (!led) {
    return
  }

  const phase = Math.pow(0.5 + 0.5 * Math.sin(time * 2.2 + part.body.seed * 6), 1.5)
  led.fill.color.copy(kit.baseFill).lerp(led.colour, 0.1 + 0.55 * phase)
  led.glow.opacity = 0.08 + 0.5 * phase
}

export function createElectronicsCurrent(
  canvas: HTMLCanvasElement,
  options: ElectronicsCurrentOptions,
): ElectronicsCurrentController | null {
  const renderer = createRenderer(canvas)

  if (!renderer) {
    return null
  }

  const random = options.random ?? Math.random
  const scene = new Scene()
  const { camera, axes } = createIsometricCamera()
  const initialTheme = options.theme ?? 'light'
  const kit = createOutlineKit(initialTheme)
  const parts: LivePart[] = []
  const hangingLayer = new Group()
  hangingLayer.name = HANGING_LAYER_NAME
  scene.add(hangingLayer)
  const pointer: PointerState = {
    active: false,
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    lastMoveAt: 0,
  }
  const scratch = {
    axis: new Vector3(),
    step: new Quaternion(),
    yaw: new Quaternion(),
    wobble: new Quaternion(),
    euler: new Euler(),
    vertical: new Vector3(0, 1, 0),
  }
  let width = 0
  let height = 0
  let time = 0
  let lastStepSeconds = 0
  let lastFrameAt = performance.now()
  let frameRequest = 0
  let running = false
  let laidOutWidth = 0

  renderer.setClearColor(0x000000, 0)
  const fog = new Fog(FINISHES[initialTheme].ground, 96, 124)
  scene.fog = fog

  function halfWidth(): number {
    return (width * UNITS_PER_PX) / 2
  }

  function halfHeight(): number {
    return (height * UNITS_PER_PX) / 2
  }

  function spacing(): number {
    return (2 * halfWidth() + 2 * EDGE_MARGIN) / Math.max(1, parts.length)
  }

  function desiredCount(): number {
    const scaled = Math.round((PARTS_AT_REFERENCE_WIDTH * width) / REFERENCE_WIDTH_PX)

    return Math.min(MAX_PARTS, Math.max(MIN_PARTS, scaled))
  }

  function buildPart(): LivePart {
    const model = partBuilders[pickPartType(random)]({ kit, random })
    const object = new Group()

    if (model.layFlat) {
      model.group.rotation.z = Math.PI / 2
    }

    object.add(model.group)
    object.scale.setScalar(model.scale * (0.8 + random() * 0.28))
    scene.add(object)

    if (model.hanging) {
      hangingLayer.add(...model.hanging.objects)
    }

    return {
      model,
      object,
      body: { position: new Vector3(), velocity: new Vector3(), seed: random() * 10 },
      spin: new Vector3(),
      disturbance: new Quaternion(),
      yaw: 0,
      yawRate: 0,
      placed: false,
    }
  }

  /** Height with the most room around it, so new parts do not land on neighbours. */
  function openHeightNear(x: number, part: LivePart): number {
    const limit = Math.max(0.5, halfHeight() - 2.6)
    let bestY = 0
    let bestClearance = -1

    for (let candidate = 0; candidate < 8; candidate++) {
      const y = (random() * 2 - 1) * limit
      let clearance = Infinity

      for (const other of parts) {
        if (other === part || !other.placed) {
          continue
        }

        const dx = (other.body.position.x - x) * 0.5
        const dy = other.body.position.y - y
        clearance = Math.min(clearance, dx * dx + dy * dy)
      }

      if (clearance > bestClearance) {
        bestClearance = clearance
        bestY = y
      }
    }

    return bestY
  }

  /** Entry point one spacing behind the last part, keeping density even. */
  function entryX(part: LivePart): number {
    let furthest = -Infinity

    for (const other of parts) {
      if (other !== part && other.placed) {
        furthest = Math.max(furthest, other.body.position.x)
      }
    }

    const behind = furthest + spacing() * (0.85 + random() * 0.3)
    const entry = Math.max(halfWidth() + 5, behind)

    return Math.min(entry, halfWidth() + 5 + spacing() * 2)
  }

  function spawn(part: LivePart, x: number): void {
    const y = openHeightNear(x, part)
    part.placed = true
    part.body.position.x = x
    part.body.position.y = y
    part.body.position.z = -8 + random() * 16
    part.body.velocity.x = -3
    part.body.velocity.y = 0
    part.body.velocity.z = 0
    part.spin.set(0, 0, 0)
    part.disturbance.identity()
    part.yaw = random() * Math.PI * 2
    part.yawRate = (random() < 0.5 ? -1 : 1) * (0.08 + random() * 0.22)
  }

  function removePart(part: LivePart): void {
    scene.remove(part.object)

    if (part.model.hanging) {
      hangingLayer.remove(...part.model.hanging.objects)
    }

    disposePartObject(part)
  }

  /** A part leaving the masthead is replaced by a freshly chosen type entering on the right. */
  function recycle(index: number): void {
    removePart(parts[index])
    const replacement = buildPart()
    parts[index] = replacement
    spawn(replacement, entryX(replacement))
    // Pose it now, so its first render (and any loose end's rim) uses its real orientation.
    orient(replacement, 0)
  }

  function layOutInitialParts(): void {
    const count = desiredCount()

    while (parts.length < count) {
      parts.push(buildPart())
    }

    const gap = spacing()

    parts.forEach((part, index) => {
      const jitter = (random() - 0.5) * 0.4
      spawn(part, -halfWidth() - EDGE_MARGIN + (index + 0.5 + jitter) * gap)
    })
  }

  function matchCountToWidth(): void {
    const count = desiredCount()

    while (parts.length < count) {
      const part = buildPart()
      parts.push(part)
      spawn(part, entryX(part))
    }

    while (parts.length > count) {
      const extra = parts.pop()

      if (extra) {
        removePart(extra)
      }
    }
  }

  function placeAll(): void {
    for (const part of parts) {
      const position = part.body.position
      part.object.position
        .set(0, 0, 0)
        .addScaledVector(axes.right, position.x)
        .addScaledVector(axes.up, position.y)
        .addScaledVector(axes.back, position.z)
    }
  }

  function pointerInScene(): PointerFlow {
    return {
      x: (pointer.x - width / 2) * UNITS_PER_PX,
      y: (height / 2 - pointer.y) * UNITS_PER_PX,
      velocityX: pointer.velocityX * UNITS_PER_PX,
      velocityY: -pointer.velocityY * UNITS_PER_PX,
    }
  }

  /** Pointer drags, nudges and spins nearby parts, and lets switches react. */
  function stirPart(part: LivePart, stir: PointerFlow, frameSeconds: number): void {
    const position = part.body.position
    const dx = (position.x - stir.x) / UNITS_PER_PX
    const dy = (position.y - stir.y) / UNITS_PER_PX
    const distancePx = Math.hypot(dx, dy)
    const influence = stirFalloff(distancePx, 1)

    if (influence <= 0) {
      return
    }

    applyStir(part.body, stir, influence, frameSeconds, random)
    const directionX = dx / (distancePx + 0.001)
    const directionY = dy / (distancePx + 0.001)
    const sideways = directionX * stir.velocityY - directionY * stir.velocityX
    part.spin.addScaledVector(axes.right, -stir.velocityY * influence * frameSeconds * 0.35)
    part.spin.addScaledVector(axes.up, stir.velocityX * influence * frameSeconds * 0.35)
    part.spin.addScaledVector(axes.back, sideways * influence * frameSeconds * 0.25)

    if (part.spin.length() > MAX_SPIN) {
      part.spin.setLength(MAX_SPIN)
    }

    part.model.react?.(influence, Math.hypot(pointer.velocityX, pointer.velocityY), time)
  }

  /** Disturbance spin springs back to the resting isometric pose, then yaw and wobble apply. */
  function orient(part: LivePart, frameSeconds: number): void {
    const seed = part.body.seed
    const angle = part.spin.length() * frameSeconds

    if (angle > 0) {
      scratch.axis.copy(part.spin).normalize()
      scratch.step.setFromAxisAngle(scratch.axis, angle)
      part.disturbance.premultiply(scratch.step)
    }

    const disturbance = part.disturbance

    if (disturbance.w < 0) {
      disturbance.set(-disturbance.x, -disturbance.y, -disturbance.z, -disturbance.w)
    }

    const offAngle = 2 * Math.acos(Math.min(1, disturbance.w))
    const axisLength = Math.sqrt(Math.max(0, 1 - disturbance.w * disturbance.w))

    if (axisLength > 1e-4) {
      const restoring = (offAngle * 1.4 * frameSeconds) / axisLength
      part.spin.x -= disturbance.x * restoring
      part.spin.y -= disturbance.y * restoring
      part.spin.z -= disturbance.z * restoring
    }

    part.spin.multiplyScalar(Math.exp(-frameSeconds * 1.6))

    if (part.model.facesViewer) {
      // Loosely face the viewer (45 degree yaw, tilted up) while drifting naturally.
      part.yaw =
        Math.PI / 4 + Math.sin(time * 0.23 + seed * 3) * 0.55 + Math.sin(time * 0.11 + seed) * 0.25
      scratch.euler.set(
        -0.38 + Math.sin(time * 0.31 + seed) * 0.12,
        0,
        Math.cos(time * 0.27 + seed * 1.3) * 0.1,
      )
    } else {
      part.yaw += part.yawRate * frameSeconds
      scratch.euler.set(
        Math.sin(time * 0.5 + seed) * 0.16,
        0,
        Math.cos(time * 0.42 + seed * 1.3) * 0.16,
      )
    }

    scratch.wobble.setFromEuler(scratch.euler)
    scratch.yaw.setFromAxisAngle(scratch.vertical, part.yaw)
    part.object.quaternion.copy(disturbance).multiply(scratch.yaw).multiply(scratch.wobble)
  }

  function isOutside(part: LivePart): boolean {
    const x = part.body.position.x

    return x < -halfWidth() - EDGE_MARGIN || x > halfWidth() + EDGE_MARGIN + spacing() * 3
  }

  function step(frameSeconds: number): void {
    time += frameSeconds
    lastStepSeconds = frameSeconds
    const verticalLimit = Math.max(0.5, halfHeight() - 2.4)
    const stir = pointerInScene()
    separate(
      parts.map((part) => part.body),
      frameSeconds,
    )

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      const body = part.body
      const target = flowTarget(body.position, time, body.seed, verticalLimit)
      relaxTowards(body.velocity, target, frameSeconds)

      if (pointer.active) {
        stirPart(part, stir, frameSeconds)
      }

      body.position.x += body.velocity.x * frameSeconds
      body.position.y += body.velocity.y * frameSeconds
      body.position.z += body.velocity.z * frameSeconds
      orient(part, frameSeconds)
      pulseLed(part, kit, time)

      if (part.model.display) {
        updateDisplay(part.model.display, time, body.seed)
      }

      part.model.animate?.(time, frameSeconds, body.seed)

      if (isOutside(part)) {
        recycle(index)
      }
    }
  }

  /** Loose ends follow their parts' new poses; a new one starts hanging straight down. */
  function updateHanging(): void {
    const frame = {
      frameSeconds: lastStepSeconds,
      right: axes.right,
      up: axes.up,
      pointer: pointer.active ? pointerInScene() : null,
      unitsPerPx: UNITS_PER_PX,
    }

    for (const part of parts) {
      part.model.hanging?.update(frame)
    }
  }

  function render(): void {
    placeAll()
    updateHanging()
    renderer?.render(scene, camera)
  }

  function frame(now: number): void {
    if (!running) {
      return
    }

    const elapsed = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - lastFrameAt) / 1000))
    lastFrameAt = now
    matchCountToWidth()
    pointer.velocityX *= Math.exp(-elapsed * POINTER_SPEED_DECAY)
    pointer.velocityY *= Math.exp(-elapsed * POINTER_SPEED_DECAY)
    step(elapsed)
    render()
    // Schedule only after a successful frame, so an error cannot repeat every frame.
    frameRequest = requestAnimationFrame(frame)
  }

  function startLoop(): void {
    if (running || options.reducedMotion) {
      return
    }

    running = true
    lastFrameAt = performance.now()
    frameRequest = requestAnimationFrame(frame)
  }

  function stopLoop(): void {
    running = false
    cancelAnimationFrame(frameRequest)
  }

  /** Reduced motion has no loop to adapt the count, so re-lay out the static frame. */
  function relayOutStaticFrame(): void {
    parts.forEach(removePart)
    parts.length = 0
    layOutInitialParts()
    step(0)
    laidOutWidth = width
  }

  function resize(): void {
    width = canvas.clientWidth || REFERENCE_WIDTH_PX
    height = canvas.clientHeight || 120
    renderer?.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer?.setSize(width, height, false)
    camera.left = (-width * UNITS_PER_PX) / 2
    camera.right = (width * UNITS_PER_PX) / 2
    camera.top = (height * UNITS_PER_PX) / 2
    camera.bottom = (-height * UNITS_PER_PX) / 2
    camera.updateProjectionMatrix()

    if (!options.reducedMotion) {
      return
    }

    // The first resize runs before any parts exist; the initial layout renders then.
    if (parts.length === 0) {
      return
    }

    if (width !== laidOutWidth) {
      relayOutStaticFrame()
    }

    render()
  }

  // Pause while the masthead is scrolled out of view; resume when it returns.
  function handleVisibility(entries: IntersectionObserverEntry[]): void {
    const visible = entries.some((entry) => entry.isIntersecting)

    if (visible) {
      startLoop()
    } else {
      stopLoop()
    }
  }

  const resizeObserver = new ResizeObserver(resize)
  const visibilityObserver =
    typeof IntersectionObserver === 'function' ? new IntersectionObserver(handleVisibility) : null

  try {
    resize()
    layOutInitialParts()
    laidOutWidth = width
    step(0)
    render()
  } catch (error) {
    // Release the WebGL context rather than leaking it on a failed start.
    parts.forEach(removePart)
    kit.dispose()
    renderer.dispose()
    throw error
  }

  resizeObserver.observe(canvas)
  visibilityObserver?.observe(canvas)
  startLoop()

  function setPointer(clientX: number, clientY: number): void {
    const bounds = canvas.getBoundingClientRect()
    const scale = width / (bounds.width || width || 1)
    const x = (clientX - bounds.left) * scale
    const y = (clientY - bounds.top) * scale
    const inside = x >= 0 && y >= 0 && x <= width && y <= height

    if (!inside) {
      pointer.active = false

      return
    }

    const now = performance.now()

    if (pointer.active) {
      const seconds = Math.max(8, now - pointer.lastMoveAt) / 1000
      pointer.velocityX += ((x - pointer.x) / seconds - pointer.velocityX) * 0.5
      pointer.velocityY += ((y - pointer.y) / seconds - pointer.velocityY) * 0.5
    }

    pointer.x = x
    pointer.y = y
    pointer.lastMoveAt = now
    pointer.active = true
  }

  function clearPointer(): void {
    pointer.active = false
  }

  function setTheme(theme: ThemeId): void {
    kit.setTheme(theme)
    fog.color.set(FINISHES[theme].ground)

    // Re-tinting resets LED fills to the base; restore each glow at the current time.
    for (const part of parts) {
      pulseLed(part, kit, time)
    }

    // A running loop picks the new colours up on its next frame; a still frame needs redrawing.
    if (options.reducedMotion) {
      render()
    }
  }

  function dispose(): void {
    stopLoop()
    resizeObserver.disconnect()
    visibilityObserver?.disconnect()
    parts.forEach(removePart)
    parts.length = 0
    kit.dispose()
    renderer?.dispose()
  }

  return { setPointer, clearPointer, setTheme, dispose }
}
