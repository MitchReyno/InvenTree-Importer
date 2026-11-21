import type { AgentSessionListDto } from '@invimport/contracts'

/** Sessions holding a slot now and sessions waiting for one, on this page of the list. */
export function slotUse(sessions: AgentSessionListDto['sessions']) {
  return {
    inUse: sessions.filter((session) => session.occupies_lane).length,
    queued: sessions.filter((session) => session.state === 'queued').length,
  }
}
