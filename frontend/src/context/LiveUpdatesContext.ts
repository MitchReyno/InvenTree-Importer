import { createContext, useContext } from 'react'
import { RETAINED_POLL_INTERVAL_MS } from '#/queries/client'

/** Retained reads' poll interval, set by `LiveUpdates` from the socket's health. */
export const RetainedPollIntervalContext = createContext<number | false>(RETAINED_POLL_INTERVAL_MS)

export function useRetainedPollInterval() {
  return useContext(RetainedPollIntervalContext)
}

export type LiveConnection = 'connecting' | 'live' | 'polling' | 'update_required'

export interface UpdateHealth {
  state: LiveConnection
  observedAt: number | null
  truncated: boolean
}

export const UpdateHealthContext = createContext<UpdateHealth>({
  state: 'connecting',
  observedAt: null,
  truncated: false,
})

export function useUpdateHealth() {
  return useContext(UpdateHealthContext)
}
