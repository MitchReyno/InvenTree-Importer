import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const digest = (c: string) => c.repeat(64)

const note = {
  kind: 'note',
  source: 'human',
  note_id: id(1),
  subject_id: null,
  text: 'Reel of 5000.',
  text_sha256: digest('a'),
  actor_id: id(2),
  created_at: '2026-11-25T01:02:03.000Z',
}
const correction = {
  kind: 'correction',
  source: 'human',
  observation_id: id(3),
  lot_id: id(4),
  before: { markings: ['16.000 ECS'] },
  after: { markings: ['16.000 ECS 2338'] },
  earlier_known: true,
  actor_id: id(2),
  corrected_at: '2026-11-25T01:02:04.000Z',
  revision: '9007199254740993',
}
const sections = [
  { name: 'batch', count: 0 },
  { name: 'human', count: 2 },
  { name: 'asked', count: 0 },
  { name: 'evidence', count: 0 },
  { name: 'match', count: 0 },
  { name: 'identity', count: 0 },
  { name: 'observations', count: 0 },
  { name: 'vocabulary', count: 0 },
]
const sealedBrief = {
  schema_version: 'bench-intake-brief/1',
  stage: 'research',
  lot_id: id(4),
  revision: '12',
  sections,
  sha256: digest('b'),
  pages: [
    { index: 1, sha256: digest('c'), entry_count: 1, entries: [note] },
    // A page kept outside the manifest carries only its digest.
    { index: 2, sha256: digest('d'), entry_count: 1 },
  ],
}
const lotScope = {
  stage: 'research',
  subject_id: id(4),
  subject: {
    id: id(4),
    label: 'Crystal',
    revision: '2',
    contribution_key: id(5),
    part_subject_id: null,
    quantity: { mode: 'unset' },
    location: { mode: 'unset' },
  },
  linked_part: null,
}
const input = {
  schema_version: 'bench-intake-input/7',
  batch_id: id(50),
  source_id: id(51),
  capture_revision: '12',
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  notes: [],
  observations: [],
  profile_id: 'synthetic-session/1',
  instruction_version: 'synthetic-session/1',
  instruction_sha256: digest('e'),
  tool_profile_version: 'native-session-stage-tools/1',
  media: { manifest: '{}', sha256: digest('f') },
  agent: null,
  settings_revision: null,
  pinned_proposal_ids: [],
  stage_instructions_sha256: digest('9'),
  brief: sealedBrief,
  ...lotScope,
}

test('input /7 seals the stage pack digest, the stage tool profile and the brief', () => {
  validate('ProcessingInputV7', input)
  validate('ProcessingInputV7', {
    ...input,
    stage: 'examine',
    subject_id: null,
    subject: null,
    linked_part: null,
    brief: { ...sealedBrief, stage: 'examine', lot_id: null },
  })
  const { stage_instructions_sha256: _pack, ...withoutPack } = input
  assert.throws(() => validate('ProcessingInputV7', withoutPack))
  const { brief: _brief, ...withoutBrief } = input
  assert.throws(() => validate('ProcessingInputV7', withoutBrief))
  // `/7` has no Inventory session, keeps the stage tool profile and is not a `/6` input.
  assert.throws(() => validate('ProcessingInputV7', { ...input, stage: 'inventory' }))
  assert.throws(() =>
    validate('ProcessingInputV7', { ...input, tool_profile_version: 'native-session-tools/1' }),
  )
  assert.throws(() => validate('ProcessingInputV6', input))
  assert.throws(() => validate('ProcessingInputV7', { ...input, profile_id: 'shared-vm-agent/3' }))
})

test('human facts in a brief say they are human; a correction may not know its earlier reading', () => {
  validate('SessionBrief', {
    schema_version: 'bench-intake-brief/1',
    stage: 'research',
    lot_id: id(4),
    revision: '12',
    sections,
    entries: [note, correction],
  })
  validate('BriefPage', {
    schema_version: 'bench-intake-brief-page/1',
    index: 2,
    entries: [
      {
        ...correction,
        before: null,
        earlier_known: false,
        actor_id: null,
        corrected_at: null,
        revision: null,
      },
    ],
  })
  assert.throws(() =>
    validate('BriefPage', {
      schema_version: 'bench-intake-brief-page/1',
      index: 1,
      entries: [{ ...note, source: 'agent' }],
    }),
  )
  assert.throws(() =>
    validate('BriefPage', {
      schema_version: 'bench-intake-brief-page/1',
      index: 65,
      entries: [],
    }),
  )
})

test('a brief read names a lot, and pages by a token or the sealed revision', () => {
  validate('SessionReadLotArgs', { lot_id: id(4) })
  validate('SessionReadLotArgs', { lot_id: id(4), revision: '12' })
  validate('SessionReadLotArgs', { lot_id: id(4), page_token: 'eyJhIjoxfQ' })
  validate('SessionReadBatchArgs', {})
  validate('SessionReadBriefBatchArgs', { page_token: 'eyJhIjoxfQ' })
  // An earlier lead's read_batch keeps taking no arguments.
  assert.throws(() => validate('SessionReadBatchArgs', { page_token: 'eyJhIjoxfQ' }))
  assert.throws(() => validate('SessionReadLotArgs', {}))
  assert.throws(() => validate('SessionReadLotArgs', { lot_id: id(4), page_token: 'a b' }))
  assert.throws(() => validate('SessionReadBriefBatchArgs', { lot_id: id(4) }))
  validate('SessionBriefPage', {
    view: 'current',
    stage: 'research',
    lot_id: id(4),
    revision: '12',
    sha256: digest('b'),
    sections,
    page: 1,
    page_count: 2,
    entries: [note],
    next_page_token: 'eyJhIjoxfQ',
    newer: { revision: '13' },
  })
})
