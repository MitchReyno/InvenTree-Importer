import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ExamineIdentityV1Dto,
  MatchPartCandidateDto,
  MatchOutcomeDto,
} from '@invimport/contracts'
import {
  companiesAgree,
  examineKeys,
  mpnKey,
  searchable,
  strongKey,
} from '#/processing/match/keys.ts'
import {
  coveredOf,
  decisionModes,
  nextStep,
  type MatchResult,
  type MatchStanding,
} from '#/processing/match/outcome.ts'
import { questionOptions } from '#/processing/match/questions.ts'

const LOT = '0b0bb2b7-9595-41f3-92bf-e901d1823cfb'
const PROPOSAL = '19290aa2-9c8f-4e8c-a95c-744abfbc3fd6'

function part(overrides: Partial<MatchPartCandidateDto> = {}): MatchPartCandidateDto {
  return {
    kind: 'part',
    part: { pk: '144', name: '10k resistor 0603', ipn: 'RES-0144', has_image: true },
    verdict: 'exact',
    matched_by: [
      {
        key: { kind: 'mpn', mpn: 'RC0603FR-0710KL', manufacturer: 'Yageo' },
        reason: 'mpn_and_manufacturer',
      },
    ],
    missing: [],
    parameters_known: true,
    stock: [],
    ...overrides,
  }
}

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    schema_version: 'bench-intake-match-result/1',
    lot_id: LOT,
    generation: '2',
    target_context_id: '3a9c1e7b-5d2f-4b8a-9c6e-0f1a2b3c4d5e',
    searched: 'remote',
    keys: [{ kind: 'mpn', mpn: 'RC0603FR-0710KL', manufacturer: 'Yageo' }],
    candidates: [],
    verdict: 'none',
    notes: [],
    ...overrides,
  }
}

function decided(decision: 'add_stock' | 'new_part', covered: string): MatchStanding {
  const outcome: MatchOutcomeDto = {
    schema_version: 'bench-intake-match-outcome/1',
    lot_id: LOT,
    revision: '2',
    basis: { kind: 'decision', decision },
    ...decisionModes(decision, part()),
  }
  return {
    identity: { kind: 'examine', proposal_id: PROPOSAL },
    outcome: { outcome, covered, targetPartPk: decision === 'add_stock' ? '144' : null },
  }
}

test('part numbers compare without case or spaces, keeping punctuation', () => {
  assert.equal(mpnKey(' rc0603fr-0710kl '), mpnKey('RC0603FR-0710KL'))
  assert.notEqual(mpnKey('1N4148W-7-F'), mpnKey('1N4148W7F'))
})

test('company names agree without their legal suffixes, or as one starting the other', () => {
  assert.equal(companiesAgree('Yageo Corporation', 'YAGEO'), true)
  assert.equal(companiesAgree('Diodes Incorporated', 'Diodes Inc.'), true)
  assert.equal(companiesAgree('Texas Instruments', 'Texas'), true)
  assert.equal(companiesAgree('TI', 'Texas Instruments'), false)
  assert.equal(companiesAgree('Vishay', 'Yageo'), false)
})

test('an MPN alone is weak; with a manufacturer, an NSN, an IPN or a SKU it is strong', () => {
  assert.equal(strongKey({ kind: 'mpn', mpn: '1N4148' }), false)
  assert.equal(strongKey({ kind: 'mpn', mpn: '1N4148', manufacturer: 'Diodes' }), true)
  assert.equal(strongKey({ kind: 'nsn', nsn: '5961-01-123-4567' }), true)
  assert.equal(strongKey({ kind: 'batch_code', batch_code: '2407' }), false)
  assert.equal(searchable([{ kind: 'batch_code', batch_code: '2407' }]), false)
})

test("Examine's keys come from its candidates with the maker, its NSN and its match notes", () => {
  const identity = {
    schema_version: 'examine-identity/1',
    subject_id: LOT,
    summary: 'A reel.',
    sources: [],
    relies_on: { fields: ['identity'], sources: [] },
    markings: [],
    candidates: [
      { mpn: 'RC0603FR-0710KL', confidence: 'high' },
      { description: 'a resistor', confidence: 'low' },
      { type: '1N4148', manufacturer: 'Diodes', confidence: 'medium' },
    ],
    maker: { name: 'Yageo', method: 'text' },
    nsn: '5961-01-123-4567',
    match_notes: [
      { kind: 'alias', text: 'House number', key: { kind: 'sku', value: 'TK-1N4148' } },
      { kind: 'negative', text: 'Not this', key: { kind: 'mpn', value: 'IGNORED' } },
    ],
  } as unknown as ExamineIdentityV1Dto
  assert.deepEqual(examineKeys(identity), [
    { kind: 'mpn', mpn: 'RC0603FR-0710KL', manufacturer: 'Yageo' },
    { kind: 'type', type: '1N4148', manufacturer: 'Diodes' },
    { kind: 'nsn', nsn: '5961-01-123-4567' },
    { kind: 'sku', sku: 'TK-1N4148' },
  ])
})

test('decisions set the modes: add stock, fill what is missing, new Part and already imported', () => {
  assert.deepEqual(decisionModes('add_stock', part()), {
    research: { stage: 'research', mode: 'skipped' },
    images: { stage: 'images', mode: 'stock', part_image: false },
  })
  // Only the Part image missing: Research is skipped, Images takes the Part image too.
  const imageOnly = part({
    part: { pk: '144', name: 'R', has_image: false },
    missing: [{ kind: 'part_image' }],
  })
  assert.deepEqual(decisionModes('fill_gaps', imageOnly), {
    research: { stage: 'research', mode: 'skipped' },
    images: { stage: 'images', mode: 'stock', part_image: true },
  })
  const gaps = part({ missing: [{ kind: 'datasheet' }, { kind: 'parameter', template: '202' }] })
  assert.deepEqual(decisionModes('fill_gaps', gaps).research, {
    stage: 'research',
    mode: 'gaps',
    fields: ['datasheet', 'parameters'],
  })
  assert.deepEqual(decisionModes('new_part', undefined), {
    research: { stage: 'research', mode: 'full' },
    images: { stage: 'images', mode: 'full' },
  })
  assert.equal(decisionModes('already_imported', undefined).images.mode, 'skipped')
})

test('a missing supplier Part alone offers no fill, and another batch’s lot offers no add stock', () => {
  const supplierOnly = part({ missing: [{ kind: 'supplier_part' }] })
  assert.deepEqual(
    questionOptions('candidates', [supplierOnly]).map((option) => option.id),
    ['add_stock_1', 'new_part', 'already_imported'],
  )
  const lot = {
    kind: 'lot' as const,
    batch_id: LOT,
    batch_title: 'Other batch',
    lot_id: PROPOSAL,
    lot_label: 'Reel',
    matched_by: supplierOnly.matched_by,
  }
  assert.deepEqual(
    questionOptions('candidates', [lot]).map((option) => option.id),
    ['new_part', 'already_imported'],
  )
  assert.deepEqual(
    questionOptions('contribution', []).map((option) => option.id),
    ['already_imported', 'keep_held'],
  )
})

test('settling follows the rules: equivalent results keep, a lost target asks, a clear one clears', () => {
  const found = result({ candidates: [part()], verdict: 'exact' })
  const covered = coveredOf(found)
  assert.deepEqual(nextStep(found, decided('add_stock', covered)), { kind: 'keep' })
  // New stock with the lot's batch code is a change the decision didn't cover.
  const withStock = result({
    candidates: [part({ stock: [{ pk: '9001', batch: '2407', quantity: '500' }] })],
  })
  assert.deepEqual(nextStep(withStock, decided('add_stock', covered)), {
    kind: 'question',
    questionKind: 'candidates',
  })
  assert.deepEqual(nextStep(result(), decided('add_stock', covered)), {
    kind: 'question',
    questionKind: 'target_lost',
  })
  assert.deepEqual(nextStep(result(), decided('new_part', covered)), { kind: 'keep' })
  const none: MatchStanding = { identity: { kind: 'examine', proposal_id: PROPOSAL } }
  assert.deepEqual(nextStep(result(), none), { kind: 'clear' })
  assert.deepEqual(nextStep(result({ searched: 'unavailable' }), none), { kind: 'unavailable' })
  assert.deepEqual(nextStep(result({ contribution: { readable: false } }), none), {
    kind: 'question',
    questionKind: 'contribution',
  })
  // An operator's lot with nothing strong is asked about; an Examine lot without a key clears
  // until identify mode exists.
  const weak = result({ searched: 'local_only', keys: [{ kind: 'mpn', mpn: '1N4148' }] })
  assert.deepEqual(nextStep(weak, { identity: { kind: 'operator', revision: '1' } }), {
    kind: 'question',
    questionKind: 'unresolved',
  })
  assert.deepEqual(nextStep(weak, none), { kind: 'clear' })
  // A question already open on the same candidates is kept.
  assert.deepEqual(nextStep(found, { ...none, openQuestion: { kind: 'candidates', covered } }), {
    kind: 'keep_question',
  })
})
