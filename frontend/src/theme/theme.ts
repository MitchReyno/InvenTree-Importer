import { useSyncExternalStore } from 'react'
import { readPreference, writePreference, type PreferenceStorage } from './device-preference'
import type { ThemeId } from './generated/tokens'

export type ThemeChoice = ThemeId | 'system'

export const THEME_STORAGE_KEY = 'bench-intake.theme'
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

type SchemeQuery = {
  readonly matches: boolean
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
}

export type ThemeEnvironment = {
  storage: () => PreferenceStorage | undefined
  media: () => SchemeQuery | undefined
  root: HTMLElement
}

export type ThemeController = {
  choice: () => ThemeChoice
  choose: (choice: ThemeChoice) => void
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}

export function createThemeController(environment: ThemeEnvironment): ThemeController {
  const query = environment.media()
  const listeners = new Set<() => void>()
  let current = readPreference(environment.storage, THEME_STORAGE_KEY, THEME_CHOICES, 'system')

  function apply() {
    const prefersDark = query?.matches ?? false
    const resolved = current === 'system' ? (prefersDark ? 'dark' : 'light') : current
    environment.root.dataset.theme = resolved
  }

  function handleSchemeChange() {
    if (current === 'system') {
      apply()
    }
  }

  query?.addEventListener('change', handleSchemeChange)
  apply()

  return {
    choice: () => current,
    choose(choice) {
      current = choice
      writePreference(environment.storage, THEME_STORAGE_KEY, choice)
      apply()
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      query?.removeEventListener('change', handleSchemeChange)
      listeners.clear()
    },
  }
}

let appController: ThemeController | undefined

/** The document's controller, created on first use. */
export function themeController(): ThemeController {
  appController ??= createThemeController({
    storage: () => window.localStorage,
    media: () => window.matchMedia?.(DARK_QUERY),
    root: document.documentElement,
  })

  return appController
}

export function useThemeChoice(controller: ThemeController = themeController()) {
  const choice = useSyncExternalStore(controller.subscribe, controller.choice)

  return { choice, choose: controller.choose }
}
