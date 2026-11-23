import { Pill, type PillTone } from './Pill'

/** The one set of words for agent and step work, wherever it shows. Lot review states stay apart. */
export type WorkState =
  'working' | 'waiting_for_you' | 'queued' | 'paused' | 'done' | 'failed' | 'not_started'

/** Each state's word, tone and glyph; every glyph differs, so colour is never the only cue. */
export const WORK_STATE: Record<WorkState, { word: string; tone: PillTone; glyph: string }> = {
  working: { word: 'Working', tone: 'acc', glyph: '⟳' },
  waiting_for_you: { word: 'Waiting for you', tone: 'warn', glyph: '?' },
  queued: { word: 'Queued', tone: 'outline', glyph: '…' },
  paused: { word: 'Paused', tone: 'neutral', glyph: '⏸' },
  done: { word: 'Done', tone: 'ok', glyph: '✓' },
  failed: { word: 'Failed', tone: 'bad', glyph: '×' },
  not_started: { word: 'Not started', tone: 'outline', glyph: '–' },
}

type StatePillProps = {
  state: WorkState
  /** A count after the word, as in "Queued · 3". */
  detail?: string
  /** Words that replace the state's own where a count leads, as in "2 working". */
  label?: string
}

/** A work state's word and glyph, with an optional detail such as a count after it. */
export function StatePill({ state, detail, label }: StatePillProps) {
  const { word, tone, glyph } = WORK_STATE[state]
  const own = label ?? word

  return (
    <Pill tone={tone} glyph={glyph}>
      {detail ? `${own} · ${detail}` : own}
    </Pill>
  )
}
