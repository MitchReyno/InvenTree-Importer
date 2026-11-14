import { useSyncExternalStore } from 'react'
import type { ThemeId } from './generated/tokens'

export type ThemeChoice = ThemeId | 'system'

export const THEME_STORAGE_KEY = 'bench-intake.theme'
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

type SchemeQuery = {
  readonly matches: boolean
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
}

export type ThemeEnvironment = {
  storage: () => ThemeStorage | undefined
  media: () => SchemeQuery | undefined
  root: HTMLElement
}

export type ThemeController = {
  choice: () => ThemeChoice
  choose: (choice: ThemeChoice) => void
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}

function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice)
}

// Storage can be missing or throw (private windows, blocked site data); the OS scheme then applies.
function readChoice(storage: ThemeEnvironment['storage']): ThemeChoice {
  try {
    const stored = storage()?.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function writeChoice(storage: ThemeEnvironment['storage'], choice: ThemeChoice) {
  try {
    storage()?.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // The choice still applies for this session.
  }
}

export function createThemeController(environment: ThemeEnvironment): ThemeController {
  const query = environment.media()
  const listeners = new Set<() => void>()
  let current = readChoice(environment.storage)

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
      writeChoice(environment.storage, choice)
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
