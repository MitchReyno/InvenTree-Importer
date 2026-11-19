import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import {
  createMastheadStyleController,
  MASTHEAD_STORAGE_KEY,
  MASTHEAD_STYLES,
  useMastheadStyle,
} from './masthead-style'

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
  const controller = createMastheadStyleController({ storage: () => storage, root })

  return { root, controller }
}

describe('masthead style controller', () => {
  it('defaults to the bar when nothing is stored', () => {
    const { root, controller } = setup(memoryStorage())

    expect(controller.style()).toBe('bar')
    expect(root.dataset.masthead).toBe('bar')
  })

  it('applies and remembers a choice', () => {
    const storage = memoryStorage()
    const { root, controller } = setup(storage)

    controller.choose('fade')

    expect(root.dataset.masthead).toBe('fade')
    expect(storage.values.get(MASTHEAD_STORAGE_KEY)).toBe('fade')
    expect(setup(storage).root.dataset.masthead).toBe('fade')
  })

  it('treats a missing storage or an unknown stored value as the bar', () => {
    expect(setup().controller.style()).toBe('bar')

    const storage = memoryStorage({ [MASTHEAD_STORAGE_KEY]: 'window-dark' })
    expect(setup(storage).controller.style()).toBe('bar')
  })

  it('starts with the bar and still switches for the session when storage throws', () => {
    const { root, controller } = setup(throwingStorage)

    expect(controller.style()).toBe('bar')

    controller.choose('window')
    expect(controller.style()).toBe('window')
    expect(root.dataset.masthead).toBe('window')
  })

  it('notifies subscribers until they unsubscribe', () => {
    const { controller } = setup(memoryStorage())
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.choose('window')
    unsubscribe()
    controller.choose('bar')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('offers the three styles in order', () => {
    expect(MASTHEAD_STYLES).toEqual(['bar', 'window', 'fade'])
  })
})

describe('useMastheadStyle', () => {
  it('reads and changes the style', () => {
    const { controller, root } = setup(memoryStorage())
    const { result } = renderHook(() => useMastheadStyle(controller))

    expect(result.current.style).toBe('bar')
    act(() => result.current.choose('window'))

    expect(result.current.style).toBe('window')
    expect(root.dataset.masthead).toBe('window')
  })
})

describe('pre-paint script', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

  function runPrePaint(stored: string | null | 'throws') {
    const root = document.createElement('html')
    const storage =
      stored === 'throws'
        ? throwingStorage
        : memoryStorage(stored ? { [MASTHEAD_STORAGE_KEY]: stored } : {})
    const run = new Function('document', 'localStorage', 'matchMedia', script)
    run({ documentElement: root }, storage, () => ({ matches: false }))

    return root
  }

  it('sets the same masthead style as the controller', () => {
    for (const stored of [...MASTHEAD_STYLES, 'unknown', null, 'throws'] as const) {
      const storage =
        stored === 'throws'
          ? throwingStorage
          : memoryStorage(stored ? { [MASTHEAD_STORAGE_KEY]: stored } : {})

      expect(runPrePaint(stored).dataset.masthead).toBe(setup(storage).root.dataset.masthead)
    }
  })

  it('leaves the theme to its own rule', () => {
    expect(runPrePaint('window').dataset.theme).toBe('light')
  })
})
