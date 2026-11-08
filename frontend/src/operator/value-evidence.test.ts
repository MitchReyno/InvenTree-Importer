import { describe, expect, it } from 'vitest'
import { evidenceWords } from './value-evidence'

describe('evidenceWords', () => {
  it('puts the source kind and agreement into words, with the matching tone', () => {
    expect(evidenceWords({ source_kind: 'packing_slip', agreement: 'disagree' })).toEqual({
      kind: 'Packing slip',
      certainty: 'Sources disagree',
      tone: 'conflict',
    })
    expect(evidenceWords({ source_kind: 'label', agreement: 'likely' })).toEqual({
      kind: 'Label',
      certainty: 'Likely',
      tone: 'likely',
    })
    expect(evidenceWords({ agreement: 'read' })).toEqual({ certainty: 'Read', tone: 'default' })
    expect(evidenceWords({})).toEqual({ tone: 'default' })
  })
})
