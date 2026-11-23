import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMastheadMotionController, MASTHEAD_MOTION_STORAGE_KEY } from './masthead-motion'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new DOMException('blocked', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
}

function setup(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const root = document.createElement('html')
  const controller = createMastheadMotionController({ storage: () => storage, root })

  return { root, controller }
}

describe('masthead motion controller', () => {
  it('animates by default', () => {
    const { root, controller } = setup(memoryStorage())

    expect(controller.motion()).toBe('on')
    expect(root.dataset.mastheadMotion).toBe('on')
  })

  it('keeps animating when the stored value is unknown or storage is blocked', () => {
    expect(
      setup(memoryStorage({ [MASTHEAD_MOTION_STORAGE_KEY]: 'sometimes' })).controller.motion(),
    ).toBe('on')
    expect(setup(throwingStorage).controller.motion()).toBe('on')
  })

  it('stores a change on the device and tells listeners', () => {
    const storage = memoryStorage()
    const { root, controller } = setup(storage)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.choose('off')

    expect(controller.motion()).toBe('off')
    expect(root.dataset.mastheadMotion).toBe('off')
    expect(storage.values.get(MASTHEAD_MOTION_STORAGE_KEY)).toBe('off')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(setup(storage).controller.motion()).toBe('off')
  })

  it('is set before first paint by the page script, under the same key', () => {
    const html = readFileSync(join(__dirname, '../../index.html'), 'utf8')

    expect(html).toContain(`localStorage.getItem('${MASTHEAD_MOTION_STORAGE_KEY}')`)
    expect(html).toContain('dataset.mastheadMotion')
  })
})
