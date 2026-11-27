import { useSyncExternalStore } from 'react'
import { readPreference, writePreference, type PreferenceStorage } from './device-preference'

/** Whether the masthead's electronics move. Off keeps the chosen style as a still frame. */
export type MastheadMotion = 'on' | 'off'

export const MASTHEAD_MOTION_STORAGE_KEY = 'bench-intake.masthead-motion'
const MOTIONS: readonly MastheadMotion[] = ['on', 'off']
const DEFAULT_MOTION: MastheadMotion = 'on'

export type MastheadMotionEnvironment = {
  storage: () => PreferenceStorage | undefined
  root: HTMLElement
}

export type MastheadMotionController = {
  motion: () => MastheadMotion
  choose: (motion: MastheadMotion) => void
  subscribe: (listener: () => void) => () => void
}

export function createMastheadMotionController(
  environment: MastheadMotionEnvironment,
): MastheadMotionController {
  const listeners = new Set<() => void>()
  let current = readPreference(
    environment.storage,
    MASTHEAD_MOTION_STORAGE_KEY,
    MOTIONS,
    DEFAULT_MOTION,
  )
  environment.root.dataset.mastheadMotion = current

  return {
    motion: () => current,
    choose(motion) {
      current = motion
      writePreference(environment.storage, MASTHEAD_MOTION_STORAGE_KEY, motion)
      environment.root.dataset.mastheadMotion = motion
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}

let appController: MastheadMotionController | undefined

/** The document's controller, created on first use. */
export function mastheadMotionController(): MastheadMotionController {
  appController ??= createMastheadMotionController({
    storage: () => window.localStorage,
    root: document.documentElement,
  })

  return appController
}

export function useMastheadMotion(
  controller: MastheadMotionController = mastheadMotionController(),
) {
  const motion = useSyncExternalStore(controller.subscribe, controller.motion)

  return { motion, choose: controller.choose }
}
