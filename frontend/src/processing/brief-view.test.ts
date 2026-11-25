import { describe, expect, it } from 'vitest'
import type { BriefEntryDto } from '@invimport/contracts'
import {
  briefObservation,
  briefRef,
  H,
  historyBrief,
  researchBriefEntries,
} from '#/test/session-history'
import { briefRefSummary, briefView, quantityWords, readingText, regionWords } from './brief-view'

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
  it('keeps every correction with the observation it changed', () => {
    const entries = [
      ...researchBriefEntries().filter((entry) => entry.kind !== 'correction'),
      correction('6', ['ATMEGA328P 2338'], ['ATMEGA328P 2340']),
      correction('7', ['ATMEGA328P 2340'], ['ATMEGA328P 2348']),
    ]
    const view = briefView(historyBrief(entries).brief)
    const [corrected] = view.observations

    expect(corrected.corrections.map((entry) => entry.revision)).toEqual(['6', '7'])
    expect(view.corrections).toEqual([])
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

  it('says what quantity a lot edit left', () => {
    expect(quantityWords({ mode: 'set', value: '480' })).toBe('quantity 480')
    expect(quantityWords({ mode: 'inherit' })).toBe('quantity from the batch')
  })

  it('summarises the brief at the start from its sealed counts, leaving out what it doesn’t hold', () => {
    expect(briefRefSummary(briefRef())).toBe(
      'Brief at start · Examine’s findings · 2 observations · 3 of your facts · 1 question already asked',
    )
    const lead = briefRef()
    expect(
      briefRefSummary({
        ...lead,
        stage: 'examine',
        sections: lead.sections.map((section) => ({ ...section, count: 0 })),
      }),
    ).toBe('Brief at start · the batch')
  })
})

describe('where a region is', () => {
  it('reads pixel regions by size and place, and line regions by their lines', () => {
    expect(
      regionWords({
        kind: 'pixels',
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        source_width: 4000,
        source_height: 3000,
      }),
    ).toBe('300×200 px at 10, 20')
    expect(regionWords({ kind: 'lines', from_line: 3, to_line: 5 })).toBe('lines 3–5')
  })
})
