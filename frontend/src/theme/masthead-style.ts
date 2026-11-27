import { useSyncExternalStore } from 'react'
import { readPreference, writePreference, type PreferenceStorage } from './device-preference'

/** Where the electronics current lives: in the bar, behind the whole window, or fading down. */
export type MastheadStyle = 'bar' | 'window' | 'fade'

export const MASTHEAD_STORAGE_KEY = 'bench-intake.masthead'
export const MASTHEAD_STYLES: readonly MastheadStyle[] = ['bar', 'window', 'fade']

const DEFAULT_STYLE: MastheadStyle = 'bar'

export type MastheadStyleEnvironment = {
  storage: () => PreferenceStorage | undefined
  root: HTMLElement
}

export type MastheadStyleController = {
  style: () => MastheadStyle
  choose: (style: MastheadStyle) => void
  subscribe: (listener: () => void) => () => void
}

export function createMastheadStyleController(
  environment: MastheadStyleEnvironment,
): MastheadStyleController {
  const listeners = new Set<() => void>()
  let current = readPreference(
    environment.storage,
    MASTHEAD_STORAGE_KEY,
    MASTHEAD_STYLES,
    DEFAULT_STYLE,
  )
  environment.root.dataset.masthead = current

  return {
    style: () => current,
    choose(style) {
      current = style
      writePreference(environment.storage, MASTHEAD_STORAGE_KEY, style)
      environment.root.dataset.masthead = style
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}

let appController: MastheadStyleController | undefined

/** The document's controller, created on first use. */
export function mastheadStyleController(): MastheadStyleController {
  appController ??= createMastheadStyleController({
    storage: () => window.localStorage,
    root: document.documentElement,
  })

  return appController
}

export function useMastheadStyle(controller: MastheadStyleController = mastheadStyleController()) {
  const style = useSyncExternalStore(controller.subscribe, controller.style)

  return { style, choose: controller.choose }
}
