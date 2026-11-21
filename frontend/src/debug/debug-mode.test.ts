import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createDebugModeController, DEBUG_STORAGE_KEY, useDebugMode } from './debug-mode'

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

describe('debug mode controller', () => {
  it('starts off on a device that never stored it', () => {
    const controller = createDebugModeController({ storage: () => memoryStorage() })

    expect(controller.enabled()).toBe(false)
  })

  it('stores the choice and reads it back on the next start', () => {
    const storage = memoryStorage()
    const first = createDebugModeController({ storage: () => storage })

    first.setEnabled(true)

    expect(storage.values.get(DEBUG_STORAGE_KEY)).toBe('on')
    expect(createDebugModeController({ storage: () => storage }).enabled()).toBe(true)
  })

  it('ignores an unknown stored value', () => {
    const storage = memoryStorage({ [DEBUG_STORAGE_KEY]: 'maybe' })

    expect(createDebugModeController({ storage: () => storage }).enabled()).toBe(false)
  })

  it('starts off and still switches for the session when storage throws', () => {
    const controller = createDebugModeController({ storage: () => throwingStorage })

    expect(controller.enabled()).toBe(false)
    controller.setEnabled(true)
    expect(controller.enabled()).toBe(true)
  })

  it('updates every subscriber at once', () => {
    const controller = createDebugModeController({ storage: () => memoryStorage() })
    const { result } = renderHook(() => useDebugMode(controller))

    expect(result.current.enabled).toBe(false)
    act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(true)
  })
})
