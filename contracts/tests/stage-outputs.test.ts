import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = (n: number) => `5a1e2f30-41bc-4d7e-a9f0-${n.toString(16).padStart(12, '0')}`
const digest = (c: string) => c.repeat(64)

const note = { kind: 'note', note_id: id(1), text_sha256: digest('a') }
const photo = { kind: 'media_version', evidence_id: id(2), version_id: id(3), sha256: digest('b') }
const reliesOn = { fields: ['identity'], sources: [note, photo] }
const web = { kind: 'web_page', url: 'https://example.com/1n4148.pdf', title: 'Datasheet' }

const examine = {
  schema_version: 'examine-identity/1',
  subject_id: id(10),
  summary: 'Reel of 1N4148 diodes.',
  sources: [photo],
  relies_on: reliesOn,
  markings: [{ observation_id: id(11), text: ['TK-1N4148', '2338'] }],
  candidates: [{ mpn: '1N4148', manufacturer: 'Diodes Inc.', confidence: 'medium' }],
  maker: { name: 'Diodes Inc.', method: 'logo_match', logo_id: 'diodes' },
  packaging: { kind: 'reel', seal: 'sealed' },
  date_code: '2338',
  nsn: '5961-01-123-4567',
  quantity: { value: '50', basis: 'Printed on the reel label.' },
  match_notes: [
    {
      kind: 'alias',
      text: 'TK-1N4148 is the distributor’s house number.',
      key: { kind: 'house_number', value: 'TK-1N4148' },
    },
  ],
}
const researchIdentity = {
  schema_version: 'research-identity/1',
  subject_id: id(10),
  summary: 'Identified as 1N4148W-7-F.',
  sources: [photo, web],
  relies_on: reliesOn,
  resolution: 'resolved',
  mpn: '1N4148W-7-F',
  manufacturer: 'Diodes Incorporated',
  aliases: [{ value: 'TK-1N4148', kind: 'house_number', sources: [photo] }],
}
const research = {
  schema_version: 'research/1',
  subject_id: id(10),
  summary: 'Small-signal switching diode.',
  sources: [note, web],
  relies_on: { fields: ['research'], sources: [note] },
  description: { text: 'Switching diode, 100 V, SOD-123.', sources: [note] },
  parameters: [
    {
      name: 'Reverse voltage',
      value: '100 V',
      template: null,
      category_mapping: null,
      sources: [note],
      pages: [2],
    },
  ],
  datasheet: { url: 'https://example.com/1n4148.pdf', pages: [1, 2], sources: [note] },
  conflicts: [{ field: 'package', values: ['SOD-123', 'SOD-323'], sources: [note] }],
}
const images = {
  schema_version: 'images/1',
  subject_id: id(10),
  summary: 'The reel, upright.',
  sources: [photo],
  relies_on: { fields: ['images'], sources: [photo] },
  images: [
    {
      role: 'part_image',
      recipe: {
        version: 'bench-intake-view/2',
        source_version_id: id(3),
        source_digest: digest('b'),
        page: 1,
        page_width: 768,
        page_height: 512,
        view: {
          region: { x: 10, y: 20, width: 300, height: 200 },
          quarter_turns: 1,
          straighten_millidegrees: 3500,
        },
        light: {
          white_balance: true,
          contrast_clip_permille: null,
          gamma_thousandths: null,
          sharpen: false,
        },
      },
    },
  ],
}

test('each stage has its own typed output, and readers accept every kind', () => {
  for (const proposal of [examine, researchIdentity, research, images]) {
    validate('StageProposal', proposal)
    validate('RetainedSessionProposal', proposal)
  }
  // `propose` publishes Examine's and Research's kinds; images go through their own tool.
  validate('SessionStageProposeArgs', { proposal: examine })
  validate('SessionStageProposeArgs', { proposal: research })
  assert.throws(() => validate('SessionStageProposeArgs', { proposal: images }))
  // A `/6` session's propose still takes only `/5` and `/6`.
  assert.throws(() => validate('SessionProposeArgs', { proposal: examine }))
  assert.throws(() => validate('SessionProposeArgs', { proposal: research }))
})

test('a typed output refuses fields of another kind and keeps web pages top-level', () => {
  assert.throws(() => validate('StageProposal', { ...examine, category: research.parameters }))
  assert.throws(() =>
    validate('StageProposal', { ...examine, quantity: { value: '50', basis: '' } }),
  )
  assert.throws(() => validate('StageProposal', { ...examine, nsn: '5961011234567' }))
  // Examine cites delivered evidence only; Research may also cite an agent-reported page.
  assert.throws(() => validate('StageProposal', { ...examine, sources: [web] }))
  assert.throws(() =>
    validate('StageProposal', {
      ...research,
      description: { text: 'Diode', sources: [web] },
    }),
  )
  assert.throws(() => validate('StageProposal', { ...researchIdentity, resolution: 'maybe' }))
})

test('an image recipe carries no marks', () => {
  const marked = structuredClone(images)
  Object.assign(marked.images[0].recipe, {
    marks: [{ kind: 'box', geometry: { x: 0, y: 0, width: 10, height: 10 } }],
  })
  assert.throws(() => validate('StageProposal', marked))
})

test('a lot input seals its Match outcome and mode; an outcome carries its revision and modes', () => {
  validate('SealedMatch', { outcome: null, mode: { stage: 'research', mode: 'identify' } })
  validate('SealedMatch', {
    outcome: { revision: '9007199254740993', basis: { kind: 'decision', decision: 'fill_gaps' } },
    mode: { stage: 'research', mode: 'gaps', fields: ['datasheet'] },
  })
  validate('SealedMatch', {
    outcome: { revision: '3', basis: { kind: 'clear' } },
    mode: { stage: 'images', mode: 'stock', part_image: true },
  })
  assert.throws(() =>
    validate('SealedMatch', {
      outcome: null,
      mode: { stage: 'research', mode: 'gaps', fields: ['part_image'] },
    }),
  )
  validate('MatchOutcome', {
    schema_version: 'bench-intake-match-outcome/1',
    lot_id: id(10),
    revision: '4',
    basis: { kind: 'decision', decision: 'add_stock' },
    research: { stage: 'research', mode: 'skipped' },
    images: { stage: 'images', mode: 'stock', part_image: false },
  })
  // Identify mode comes before Match has a key, so no outcome sets it.
  assert.throws(() =>
    validate('MatchOutcome', {
      schema_version: 'bench-intake-match-outcome/1',
      lot_id: id(10),
      revision: '4',
      basis: { kind: 'clear' },
      research: { stage: 'research', mode: 'identify' },
      images: { stage: 'images', mode: 'full' },
    }),
  )
})

test('a revision names each change, who made it and the brief revision; the earlier shape stays', () => {
  const base = { id: id(20), seq: '7', created_at: '2026-11-25T01:02:03.000Z', kind: 'revision' }
  validate('SessionInboxItem', {
    ...base,
    payload: { fields: ['identity'], reason: 'The lot’s identity was revised.' },
  })
  validate('SessionInboxItem', {
    ...base,
    payload: {
      schema_version: 'bench-intake-revision/2',
      fields: ['markings', 'identity'],
      reason: 'The operator corrected a reading.',
      changes: [
        {
          kind: 'reading',
          observation_id: id(11),
          reading_from: { markings: ['16.000 ECS'] },
          reading_to: { markings: ['16.000 ECS 2338'] },
        },
        {
          kind: 'proposal',
          proposal_id: id(21),
          proposal_kind: 'research/1',
          state: 'stale',
          reason: 'operator_correction',
        },
        { kind: 'field', subject_id: id(10), field: 'quantity', from: null, to: '50 counted' },
        { kind: 'observation', observation_id: id(11), lot_from: id(10), lot_to: null },
        { kind: 'evidence', evidence_id: id(2), removed: true },
        { kind: 'match', lot_id: id(10), from: '2', to: '3' },
      ],
      source: { kind: 'operator', actor_id: id(22) },
      brief_revision: '9007199254740993',
    },
  })
  assert.throws(() =>
    validate('SessionInboxItem', {
      ...base,
      payload: {
        schema_version: 'bench-intake-revision/2',
        fields: ['identity'],
        reason: 'Nothing changed.',
        changes: [],
        source: { kind: 'match' },
        brief_revision: '3',
      },
    }),
  )
})

test('a `/7` ask may name new evidence or a conflict; a `/6` ask may not', () => {
  const ask = {
    schema_version: 'bench-intake-question/2',
    subject_id: id(10),
    reason: 'The datasheet disagrees with the reading.',
    fields: ['identity'],
    steps: [
      {
        id: 'mpn',
        prompt: 'Which part number is right?',
        assumption: 'Using the reading.',
        answer: { kind: 'text' },
      },
    ],
  }
  const extended = {
    ...ask,
    new_evidence: [{ evidence_id: id(2), version_id: id(3) }],
    conflict: 'reading 74HC00 against datasheet 74HCT00',
  }
  validate('SessionStageAskArgs', extended)
  assert.throws(() => validate('SessionAskArgsV2', extended))
  assert.throws(() => validate('SessionStageAskArgs', { ...ask, conflict: '' }))
})

test('a photo release names the view it releases; ask and fetch results carry their extras', () => {
  validate('SessionOutboxItem', {
    session_id: id(30),
    seq: '4',
    created_at: '2026-11-25T01:02:03.000Z',
    kind: 'photo_release',
    payload: { view_seq: '3' },
  })
  validate('SessionToolResult', { ok: true, pending_inbox: 0, view_seq: '3' })
  validate('SessionToolResult', {
    ok: true,
    pending_inbox: 0,
    id: id(31),
    existing_question: {
      question: {
        kind: 'question',
        question_id: id(31),
        job_id: id(32),
        subject_id: id(10),
        fields: ['quantity'],
        state: 'answered',
        title: 'How many?',
        steps: [{ id: 'count', prompt: 'How many?', assumption: 'One.' }],
        answer_id: id(33),
      },
      answer: {
        kind: 'answer',
        source: 'human',
        question_id: id(31),
        answer_id: id(33),
        subject_id: id(10),
        actor_id: id(22),
        answered_at: '2026-11-25T01:02:03.000Z',
        steps: [{ step_id: 'count', prompt: 'How many?', value: '50 counted' }],
      },
    },
  })
})
