import type { ReactNode } from 'react'
import { Pill, type PillTone } from './Pill'

/** The one set of work states for sessions, steps and the masthead. */
export type WorkState =
  'working' | 'waiting_for_you' | 'queued' | 'paused' | 'done' | 'failed' | 'not_started'

/** Each state's word, tone and glyph, so colour is never its only cue. */
const WORK_STATE: Record<WorkState, { word: string; tone: PillTone; glyph: string }> = {
  working: { word: 'Working', tone: 'acc', glyph: '⟳' },
  waiting_for_you: { word: 'Waiting for you', tone: 'warn', glyph: '?' },
  queued: { word: 'Queued', tone: 'outline', glyph: '…' },
  paused: { word: 'Paused', tone: 'neutral', glyph: '‖' },
  done: { word: 'Done', tone: 'ok', glyph: '✓' },
  failed: { word: 'Failed', tone: 'bad', glyph: '×' },
  not_started: { word: 'Not started', tone: 'outline', glyph: '○' },
}

export function workStateWord(state: WorkState) {
  return WORK_STATE[state].word
}

/** A work state's pill; `children` can give a fuller word, such as "2 working". */
export function StatePill({ state, children }: { state: WorkState; children?: ReactNode }) {
  const { word, tone, glyph } = WORK_STATE[state]

  return (
    <Pill tone={tone} glyph={glyph}>
      {children ?? word}
    </Pill>
  )
}
