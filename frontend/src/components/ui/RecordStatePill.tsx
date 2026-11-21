import type { ReactNode } from 'react'
import { Pill, type PillStatus } from './Pill'

const RECORD_STATUS: Record<string, PillStatus | undefined> = {
  new: 'new',
  update: 'update',
  exists: 'exists',
  choose: 'needs-answer',
  unsupported: 'failed',
}

/** One record state, the same tone and glyph in Changes, Records and RecordChain. */
export function RecordStatePill({ state, children }: { state: string; children: ReactNode }) {
  // Some DTOs type the state as a string; an unknown one reads as neutral rather than failing.
  return <Pill status={RECORD_STATUS[state] ?? 'excluded'}>{children}</Pill>
}
