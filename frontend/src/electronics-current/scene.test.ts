import { BufferGeometry, type Scene } from 'three'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElectronicsCurrent } from './scene'

interface FakeRenderer {
  lastScene: Scene | null
  renders: number
  disposed: boolean
}

const rendering = vi.hoisted(() => ({ instances: [] as FakeRenderer[] }))

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

function runFrames(count: number): void {
  let now = performance.now()

  for (let index = 0; index < count; index++) {
    const next = frames.shift()

    if (!next) {
      return
    }

    now += 16.7
    next(now)
  }
}

function setVisible(visible: boolean): void {
  visibilityCallback?.(
    [{ isIntersecting: visible } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
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
  expect(currentRenderer().lastScene?.children.length).toBe(30)
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
  const initial = new Set(currentRenderer().lastScene?.children.map((child) => child.uuid))

  // About 90 simulated seconds: every starting part crosses the masthead.
  runFrames(1800)
  const children = currentRenderer().lastScene?.children ?? []
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
  const positions = currentRenderer().lastScene?.children.map((child) => child.position) ?? []

  expect(positions).toHaveLength(30)
  positions.forEach((position) => {
    expect(Number.isFinite(position.x + position.y + position.z)).toBe(true)
  })
  controller.dispose()
})
