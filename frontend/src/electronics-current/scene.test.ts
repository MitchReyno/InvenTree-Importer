import { BufferGeometry, Vector3, type Fog, type Mesh, type Scene } from 'three'
import { FINISHES } from './finishes'
import type { PartType } from './part-model'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WICK_ANCHOR } from './parts/wick'
import { createElectronicsCurrent, HANGING_LAYER_NAME } from './scene'

interface FakeRenderer {
  lastScene: Scene | null
  renders: number
  disposed: boolean
}

const rendering = vi.hoisted(() => ({ instances: [] as FakeRenderer[] }))

// Lets one test fill the masthead with a single part type; null keeps the real weighted pick.
const catalogue = vi.hoisted(() => ({ forcedType: null as PartType | null }))

vi.mock('./catalogue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalogue')>()

  return {
    ...actual,
    pickPartType: (random: () => number) => catalogue.forcedType ?? actual.pickPartType(random),
  }
})

// jsdom has no WebGL: replace only the renderer and keep the rest of three.js real.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()

  class TestRenderer {
    lastScene: Scene | null = null
    renders = 0
    disposed = false

    constructor() {
      rendering.instances.push(this)
    }

    setPixelRatio(): void {}

    setClearColor(): void {}

    setSize(): void {}

    render(scene: Scene): void {
      this.lastScene = scene
      this.renders += 1
    }

    dispose(): void {
      this.disposed = true
    }
  }

  return { ...actual, WebGLRenderer: TestRenderer }
})

let frames: FrameRequestCallback[] = []
let visibilityCallback: IntersectionObserverCallback | null = null
const observers = { resizeDisconnect: vi.fn(), visibilityDisconnect: vi.fn() }

/** Deterministic random source so every run lays out the same parts. */
function seededRandom(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

// Frame timestamps keep advancing across calls, so stepping one frame at a time is still 16.7 ms.
let clock = 0

function runFrames(count: number): void {
  clock = Math.max(clock, performance.now())

  for (let index = 0; index < count; index++) {
    const next = frames.shift()

    if (!next) {
      return
    }

    clock += 16.7
    next(clock)
  }
}

function setVisible(visible: boolean): void {
  visibilityCallback?.(
    [{ isIntersecting: visible } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

/** The scene's part objects, leaving out the layer that holds loose ends. */
function partObjects(scene: Scene | null | undefined) {
  return (scene?.children ?? []).filter((child) => child.name !== HANGING_LAYER_NAME)
}

function currentRenderer(): FakeRenderer {
  return rendering.instances[rendering.instances.length - 1]
}

function start(reducedMotion: boolean) {
  const controller = createElectronicsCurrent(document.createElement('canvas'), {
    reducedMotion,
    random: seededRandom(7),
  })

  if (!controller) {
    throw new Error('expected a controller with the fake renderer')
  }

  return controller
}

beforeEach(() => {
  frames = []
  visibilityCallback = null
  rendering.instances.length = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)

      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}

      disconnect(): void {
        observers.resizeDisconnect()
      }
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visibilityCallback = callback
      }

      observe(): void {}

      disconnect(): void {
        observers.visibilityDisconnect()
      }
    },
  )
})

afterEach(() => {
  catalogue.forcedType = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  observers.resizeDisconnect.mockReset()
  observers.visibilityDisconnect.mockReset()
})

test('reduced motion renders one static frame and never starts a loop', () => {
  const controller = start(true)
  setVisible(true)

  expect(requestAnimationFrame).not.toHaveBeenCalled()
  expect(currentRenderer().renders).toBe(1)
  expect(partObjects(currentRenderer().lastScene)).toHaveLength(30)
  controller.dispose()
})

test('disposing stops the loop, disconnects observers and frees GPU resources', () => {
  const controller = start(false)
  const disposeGeometry = vi.spyOn(BufferGeometry.prototype, 'dispose')
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

  controller.dispose()
  runFrames(5)

  expect(cancelAnimationFrame).toHaveBeenCalled()
  expect(observers.resizeDisconnect).toHaveBeenCalledTimes(1)
  expect(observers.visibilityDisconnect).toHaveBeenCalledTimes(1)
  expect(disposeGeometry.mock.calls.length).toBeGreaterThan(30)
  expect(currentRenderer().disposed).toBe(true)
  expect(currentRenderer().renders).toBe(1)
})

test('the loop pauses while the masthead is off-screen and resumes when it returns', () => {
  const controller = start(false)
  runFrames(3)
  const rendersBeforePause = currentRenderer().renders

  setVisible(false)
  runFrames(5)

  expect(currentRenderer().renders).toBe(rendersBeforePause)
  expect(frames).toHaveLength(0)

  setVisible(true)
  runFrames(3)

  expect(currentRenderer().renders).toBe(rendersBeforePause + 3)
  controller.dispose()
})

test('parts leaving the masthead are replaced while the count stays steady', () => {
  const controller = start(false)
  const initial = new Set(partObjects(currentRenderer().lastScene).map((child) => child.uuid))

  // About 90 simulated seconds: every starting part crosses the masthead.
  runFrames(1800)
  const children = partObjects(currentRenderer().lastScene)
  const survivors = children.filter((child) => initial.has(child.uuid))

  expect(children).toHaveLength(30)
  expect(survivors.length).toBeLessThan(30)
  controller.dispose()
})

test('stirring with the pointer keeps every part position finite', () => {
  const controller = start(false)

  for (let move = 0; move < 60; move++) {
    controller.setPointer(200 + move * 15, 40 + (move % 5) * 10)
    runFrames(2)
  }

  controller.setPointer(-500, -500)
  runFrames(10)
  const positions = partObjects(currentRenderer().lastScene).map((child) => child.position)

  expect(positions).toHaveLength(30)
  positions.forEach((position) => {
    expect(Number.isFinite(position.x + position.y + position.z)).toBe(true)
  })
  controller.dispose()
})

test('a theme change re-tints fog and parts without rebuilding them, re-rendering the still frame', () => {
  const controller = start(true)
  const scene = currentRenderer().lastScene!
  const partsBefore = [...scene.children]
  const fog = scene.fog as Fog

  expect(fog.color.getHex()).toBe(FINISHES.light.ground)

  controller.setTheme('dark')

  expect(fog.color.getHex()).toBe(FINISHES.dark.ground)
  expect(scene.children).toEqual(partsBefore)
  expect(currentRenderer().renders).toBe(2)
  controller.dispose()
})

test('a round trip through the dark theme restores every colour, lit LEDs included', () => {
  const controller = start(true)
  const scene = currentRenderer().lastScene!

  const colours = () => {
    const found: number[] = []
    scene.traverse((object) => {
      const material = (object as { material?: { color?: { getHex: () => number } } }).material
      if (material?.color) {
        found.push(material.color.getHex())
      }
    })
    return found
  }

  const before = colours()

  controller.setTheme('dark')
  expect(colours()).not.toEqual(before)
  controller.setTheme('light')

  expect(colours()).toEqual(before)
  controller.dispose()
})

test('starts in the requested theme', () => {
  const controller = createElectronicsCurrent(document.createElement('canvas'), {
    reducedMotion: true,
    theme: 'dark',
    random: seededRandom(7),
  })
  const fog = currentRenderer().lastScene!.fog as Fog

  expect(fog.color.getHex()).toBe(FINISHES.dark.ground)
  controller?.dispose()
})

test('loose ends join the scene with their dispensers, follow them and leave with them', () => {
  catalogue.forcedType = 'solderWick'
  const controller = start(false)
  const scene = currentRenderer().lastScene
  const layer = scene?.getObjectByName(HANGING_LAYER_NAME)
  const initial = new Set(layer?.children.map((child) => child.uuid))
  const ribbonDisposals = (layer?.children ?? []).map((child) =>
    vi.spyOn((child as Mesh).geometry, 'dispose'),
  )

  expect(layer?.children).toHaveLength(60)

  runFrames(1800)
  const positions = layer?.children.flatMap((child) =>
    Array.from((child as Mesh).geometry.getAttribute('position').array),
  )
  const survivors = layer?.children.filter((child) => initial.has(child.uuid)) ?? []

  expect(layer?.children).toHaveLength(60)
  expect(survivors.length).toBeLessThan(60)
  expect(positions?.every(Number.isFinite)).toBe(true)

  // Each ribbon starts on its dispenser's rim as rendered, so loose ends never trail a frame.
  const ribbonStarts = (layer?.children ?? [])
    .filter((child) => (child as Mesh).isMesh)
    .map((child) => {
      const edge = (child as Mesh).geometry.getAttribute('position')
      const left = new Vector3().fromBufferAttribute(edge, 0)

      return left.add(new Vector3().fromBufferAttribute(edge, 1)).multiplyScalar(0.5)
    })
  partObjects(scene).forEach((object) => {
    object.updateWorldMatrix(true, true)
    const rim = object.children[0].localToWorld(WICK_ANCHOR.clone())
    const nearest = Math.min(...ribbonStarts.map((start) => start.distanceTo(rim)))

    expect(nearest).toBeLessThan(1e-4)
  })

  ribbonDisposals.push(
    ...(layer?.children ?? []).map((child) => vi.spyOn((child as Mesh).geometry, 'dispose')),
  )
  controller.dispose()

  // Every loose end, recycled or still in place at the end, released its own geometry.
  expect(layer?.children).toHaveLength(0)
  expect(ribbonDisposals.length).toBeGreaterThan(60)
  ribbonDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1))
})

test('the reduced-motion still frame hangs each loose end straight down from its rim', () => {
  catalogue.forcedType = 'solderWick'
  const controller = start(true)
  const scene = currentRenderer().lastScene
  const ribbons = (scene?.getObjectByName(HANGING_LAYER_NAME)?.children ?? [])
    .filter((child) => (child as Mesh).isMesh)
    .map((child) => (child as Mesh).geometry.getAttribute('position'))

  function midpoint(positions: (typeof ribbons)[number], index: number): Vector3 {
    const left = new Vector3().fromBufferAttribute(positions, index * 2)

    return left.add(new Vector3().fromBufferAttribute(positions, index * 2 + 1)).multiplyScalar(0.5)
  }

  expect(ribbons).toHaveLength(30)
  partObjects(scene).forEach((object) => {
    object.updateWorldMatrix(true, true)
    const rim = object.children[0].localToWorld(WICK_ANCHOR.clone())
    const ribbon = ribbons.find((positions) => midpoint(positions, 0).distanceTo(rim) < 1e-4)

    if (!ribbon) {
      throw new Error('every dispenser should have a loose end on its rim')
    }

    const end = midpoint(ribbon, 11)
    expect(end.x).toBeCloseTo(rim.x, 4)
    expect(end.z).toBeCloseTo(rim.z, 4)
    expect(end.y).toBeLessThan(rim.y)
  })
  controller.dispose()
})

test('a recycled dispenser enters already posed, so its loose end does not whip', () => {
  catalogue.forcedType = 'solderWick'
  const controller = start(false)
  const scene = currentRenderer().lastScene
  const layer = scene?.getObjectByName(HANGING_LAYER_NAME)
  const seen = new Set(layer?.children.map((child) => child.uuid))
  let checked = 0

  for (let frame = 0; frame < 1800 && checked < 5; frame++) {
    const fresh = (layer?.children ?? []).filter(
      (child) => (child as Mesh).isMesh && !seen.has(child.uuid),
    )
    layer?.children.forEach((child) => seen.add(child.uuid))
    runFrames(1)

    fresh.forEach((child) => {
      const positions = (child as Mesh).geometry.getAttribute('position')
      const start = new Vector3().fromBufferAttribute(positions, 0)
      start.add(new Vector3().fromBufferAttribute(positions, 1)).multiplyScalar(0.5)
      const end = new Vector3().fromBufferAttribute(positions, 22)
      end.add(new Vector3().fromBufferAttribute(positions, 23)).multiplyScalar(0.5)

      // One frame after entering, the end still hangs almost straight below the rim.
      expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.3)
      checked += 1
    })
  }

  expect(checked).toBeGreaterThan(0)
  controller.dispose()
})
