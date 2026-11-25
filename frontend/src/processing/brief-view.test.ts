import { describe, expect, it } from 'vitest'
import type { BriefEntryDto } from '@invimport/contracts'
import { briefObservation, H, historyBrief, researchBriefEntries } from '#/test/session-history'
import { briefSummary, briefView, factCount, quantityWords, readingText } from './brief-view'

function correction(revision: string, before: string[], after: string[]): BriefEntryDto {
  return {
    kind: 'correction',
    source: 'human',
    observation_id: H.observation,
    lot_id: H.lot,
    before: { markings: before },
    after: { markings: after },
    earlier_known: true,
    actor_id: H.actor,
    corrected_at: '2026-11-24T02:03:00.000Z',
    revision,
  }
}

describe('a brief as the session page shows it', () => {
  it('keeps every correction with the observation it changed, and counts each as your fact', () => {
    const entries = [
      ...researchBriefEntries().filter((entry) => entry.kind !== 'correction'),
      correction('6', ['ATMEGA328P 2338'], ['ATMEGA328P 2340']),
      correction('7', ['ATMEGA328P 2340'], ['ATMEGA328P 2348']),
    ]
    const view = briefView(historyBrief(entries).brief)
    const [corrected] = view.observations

    expect(corrected.corrections.map((entry) => entry.revision)).toEqual(['6', '7'])
    expect(view.corrections).toEqual([])
    // Two corrections, the answer and the note.
    expect(factCount(view)).toBe(4)
    expect(briefSummary(historyBrief(entries).brief)).toBe(
      'Started from Examine’s findings · 2 observations · 4 of your facts · 1 question already asked',
    )
  })

  it('lists a correction to an observation the brief doesn’t carry on its own', () => {
    const entries = [briefObservation(H.observation2, ['10k']), correction('7', ['10K'], ['10k'])]
    const view = briefView(historyBrief(entries).brief)

    expect(view.observations[0].corrections).toEqual([])
    expect(view.corrections).toHaveLength(1)
  })

  it('reads a reading as its markings and its labelled text, so moving words between them shows', () => {
    expect(readingText({ markings: ['ABC'], text: '123' })).toBe('ABC · read as “123”')
    expect(readingText({ markings: ['ABC', '123'] })).toBe('ABC · 123')
    expect(readingText({ markings: [], text: '123' })).toBe('read as “123”')
  })

  it('counts saved instructions among your facts', () => {
    const instruction: BriefEntryDto = {
      kind: 'instruction',
      instruction_id: H.instruction,
      group_id: null,
      text: 'Prefer the maker’s datasheet',
    }
    const view = briefView(historyBrief([instruction]).brief)

    expect(factCount(view)).toBe(1)
    expect(briefSummary(historyBrief([instruction]).brief)).toBe(
      'Started from Examine’s findings · 1 of your facts',
    )
  })

  it('says what quantity a lot edit left', () => {
    expect(quantityWords({ mode: 'set', value: '480' })).toBe('quantity 480')
    expect(quantityWords({ mode: 'inherit' })).toBe('quantity from the batch')
  })

  it('names what an Examine lead started from, and leaves out what it doesn’t hold', () => {
    const lead = historyBrief([]).brief

    expect(briefSummary({ ...lead, stage: 'examine', lot_id: null })).toBe('Started from the batch')
  })
})
