import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { createThemeController, THEME_STORAGE_KEY, useThemeChoice } from './theme'

type Listener = (event: { matches: boolean }) => void

function fakeMedia(initiallyDark: boolean) {
  const listeners = new Set<Listener>()
  const query = {
    matches: initiallyDark,
    addEventListener: (_type: 'change', listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: Listener) => listeners.delete(listener),
  }

  return {
    query,
    change(dark: boolean) {
      query.matches = dark
      listeners.forEach((listener) => listener({ matches: dark }))
    },
    listenerCount: () => listeners.size,
  }
}

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

function setup(options: { dark?: boolean; storage?: Pick<Storage, 'getItem' | 'setItem'> }) {
  const media = fakeMedia(options.dark ?? false)
  const root = document.createElement('html')
  const controller = createThemeController({
    storage: () => options.storage,
    media: () => media.query,
    root,
  })

  return { media, root, controller }
}

describe('theme controller', () => {
  it('follows the OS scheme when nothing is stored', () => {
    const { root, controller } = setup({ dark: true, storage: memoryStorage() })

    expect(controller.choice()).toBe('system')
    expect(root.dataset.theme).toBe('dark')
  })

  it('applies and remembers an explicit choice', () => {
    const storage = memoryStorage()
    const { root, controller } = setup({ storage })

    controller.choose('dark')

    expect(root.dataset.theme).toBe('dark')
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(setup({ storage }).root.dataset.theme).toBe('dark')
  })

  it('tracks OS changes only while the choice is System', () => {
    const { media, root, controller } = setup({ storage: memoryStorage() })

    media.change(true)
    expect(root.dataset.theme).toBe('dark')

    controller.choose('light')
    media.change(true)
    expect(root.dataset.theme).toBe('light')

    controller.choose('system')
    expect(root.dataset.theme).toBe('dark')
  })

  it('falls back to the OS and still switches for the session when storage throws', () => {
    const { root, controller } = setup({ dark: true, storage: throwingStorage })

    expect(controller.choice()).toBe('system')
    expect(root.dataset.theme).toBe('dark')

    controller.choose('light')
    expect(controller.choice()).toBe('light')
    expect(root.dataset.theme).toBe('light')
  })

  it('treats a missing storage or an unknown stored value as System', () => {
    expect(setup({ dark: true }).controller.choice()).toBe('system')

    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' })
    expect(setup({ storage }).controller.choice()).toBe('system')
  })

  it('notifies subscribers and stops listening when disposed', () => {
    const { media, controller } = setup({ storage: memoryStorage() })
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.choose('dark')
    expect(listener).toHaveBeenCalledTimes(1)

    controller.dispose()
    expect(media.listenerCount()).toBe(0)
  })
})

describe('useThemeChoice', () => {
  it('reads and changes the choice', () => {
    const { controller, root } = setup({ storage: memoryStorage() })
    const { result } = renderHook(() => useThemeChoice(controller))

    expect(result.current.choice).toBe('system')
    act(() => result.current.choose('dark'))

    expect(result.current.choice).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
  })
})

describe('pre-paint script', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

  function runPrePaint(stored: string | null | 'throws', dark: boolean) {
    const root = document.createElement('html')
    const storage =
      stored === 'throws'
        ? throwingStorage
        : memoryStorage(stored ? { [THEME_STORAGE_KEY]: stored } : {})
    const run = new Function('document', 'localStorage', 'matchMedia', script)
    run({ documentElement: root }, storage, () => ({ matches: dark }))

    return root.dataset.theme
  }

  it('runs before the app module', () => {
    expect(script).not.toBe('')
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
  })

  it('sets the stored or OS theme before first paint', () => {
    expect(runPrePaint('dark', false)).toBe('dark')
    expect(runPrePaint('light', true)).toBe('light')
    expect(runPrePaint('system', true)).toBe('dark')
    expect(runPrePaint(null, false)).toBe('light')
    expect(runPrePaint('throws', true)).toBe('dark')
  })
})
