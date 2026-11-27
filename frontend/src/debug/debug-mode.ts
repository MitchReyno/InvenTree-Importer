import { useSyncExternalStore } from 'react'
import { readPreference, writePreference, type PreferenceStorage } from '#/theme/device-preference'

/** Debug mode shows IDs, revisions, hashes and raw states; it is stored on this device only. */
export const DEBUG_STORAGE_KEY = 'bench-intake.debug'

const DEBUG_VALUES = ['on', 'off'] as const

type DebugValue = (typeof DEBUG_VALUES)[number]

export type DebugModeEnvironment = {
  storage: () => PreferenceStorage | undefined
}

export type DebugModeController = {
  enabled: () => boolean
  setEnabled: (enabled: boolean) => void
  subscribe: (listener: () => void) => () => void
}

export function createDebugModeController(environment: DebugModeEnvironment): DebugModeController {
  const listeners = new Set<() => void>()
  let current: DebugValue = readPreference(
    environment.storage,
    DEBUG_STORAGE_KEY,
    DEBUG_VALUES,
    'off',
  )

  return {
    enabled: () => current === 'on',
    setEnabled(enabled) {
      current = enabled ? 'on' : 'off'
      writePreference(environment.storage, DEBUG_STORAGE_KEY, current)
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}

let appController: DebugModeController | undefined

/** The document's controller, created on first use. */
export function debugModeController(): DebugModeController {
  appController ??= createDebugModeController({ storage: () => window.localStorage })

  return appController
}

export function useDebugMode(controller: DebugModeController = debugModeController()) {
  const enabled = useSyncExternalStore(controller.subscribe, controller.enabled)

  return { enabled, setEnabled: controller.setEnabled }
}
