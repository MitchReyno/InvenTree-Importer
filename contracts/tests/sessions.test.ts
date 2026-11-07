import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const digest = (c: string) => c.repeat(64)
const mediaSource = {
  kind: 'media_version',
  evidence_id: id(11),
  version_id: id(12),
  sha256: digest('b'),
}
const noteSource = { kind: 'note', note_id: id(13), text_sha256: digest('c') }
const reference = (model: string, n: number) => ({
  observation_id: id(n),
  target_context_id: id(99),
  model,
  pk: String(n + 400),
})

test('a status line is one line of 1 to 120 characters', () => {
  validate('SessionStatusArgs', { text: 'x'.repeat(120) })
  validate('SessionStatusArgs', { text: 'Comparing markings with datasheet candidates' })
  assert.throws(() => validate('SessionStatusArgs', { text: 'x'.repeat(121) }))
  assert.throws(() => validate('SessionStatusArgs', { text: '' }))
  assert.throws(() => validate('SessionStatusArgs', { text: 'Reading label\nthen counting' }))
  assert.throws(() => validate('SessionStatusArgs', { text: 'ok', extra: true }))
})

test('a question names the fields it affects and the assumption the agent continues with', () => {
  const ask = {
    kind: 'quantity',
    subject_id: id(1),
    prompt: 'How many reels are in the bag?',
    reason: 'The label is folded over the count.',
    fields: ['quantity'],
    assumption: 'Treating the bag as one reel until answered.',
  }
  validate('SessionAskArgs', ask)
  validate('SessionAskArgs', { ...ask, subject_id: null, fields: ['identity', 'markings'] })
  const { fields, assumption, ...bare } = ask
  assert.ok(fields && assumption)
  assert.throws(() => validate('SessionAskArgs', bare))
  assert.throws(() => validate('SessionAskArgs', { ...ask, fields: [] }))
  assert.throws(() => validate('SessionAskArgs', { ...ask, fields: ['quantity', 'quantity'] }))
  assert.throws(() => validate('SessionAskArgs', { ...ask, fields: ['approval'] }))
  assert.throws(() => validate('SessionAskArgs', { ...ask, assumption: '' }))
  const { assumption: _omitted, ...withoutAssumption } = ask
  assert.throws(() => validate('SessionAskArgs', withoutAssumption))
})

const outboxBase = { session_id: id(2), seq: '7', created_at: '2026-11-06T01:02:03.004Z' }
const outboxPayloads: Record<string, unknown> = {
  status: { text: 'Reading the reel label' },
  observation: { evidence_observation_id: id(3) },
  lot: { lot_id: id(4) },
  regroup: { lot_ids: [id(4), id(5)] },
  proposal: { proposal_id: id(6) },
  question: { question_id: id(7) },
  reply: { inbox_item_id: id(8), text: 'The reel is 1k ohm, so I will update the identity.' },
}

test('the outbox carries exactly seven kinds of item', () => {
  for (const [kind, payload] of Object.entries(outboxPayloads)) {
    validate('SessionOutboxItem', { ...outboxBase, kind, payload })
  }
  assert.throws(() =>
    validate('SessionOutboxItem', { ...outboxBase, kind: 'thinking', payload: { text: 'hmm' } }),
  )
  assert.throws(() =>
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'status',
      payload: { text: 'x'.repeat(121) },
    }),
  )
  assert.throws(() =>
    validate('SessionOutboxItem', { ...outboxBase, kind: 'lot', payload: outboxPayloads.status }),
  )
})

const inboxBase = { id: id(20), seq: '3', created_at: '2026-11-06T01:02:03.004Z' }
const inboxPayloads: Record<string, unknown> = {
  answer: {
    question_id: id(7),
    answer_id: id(21),
    value: { kind: 'quantity', value: '20', basis: 'counted' },
  },
  chat: { text: 'The reel is 1k ohm.' },
  evidence: { evidence_id: id(11), version_id: id(12) },
  revision: { fields: ['identity'], reason: 'Operator corrected the manufacturer.' },
}

test('the inbox carries answers, chat, new evidence and revisions only', () => {
  for (const [kind, payload] of Object.entries(inboxPayloads)) {
    validate('SessionInboxItem', { ...inboxBase, kind, payload })
  }
  assert.throws(() =>
    validate('SessionInboxItem', { ...inboxBase, kind: 'approval', payload: { text: 'go' } }),
  )
  assert.throws(() =>
    validate('SessionInboxItem', {
      ...inboxBase,
      kind: 'revision',
      payload: { fields: [], reason: 'x' },
    }),
  )
  validate('SessionInboxSubmission', { idempotency_key: id(30), text: 'Check the back label too.' })
  assert.throws(() => validate('SessionInboxSubmission', { idempotency_key: id(30), text: '' }))
})

test('session states include waiting and recovery states', () => {
  for (const state of [
    'queued',
    'running',
    'waiting_input',
    'finished',
    'cancelling',
    'cancelled',
    'interrupted',
    'failed',
    'waiting_for_login',
    'waiting_for_capacity',
    'resume_unavailable',
  ]) {
    validate('SessionState', state)
  }
  assert.throws(() => validate('SessionState', 'paused_forever'))
})

const relies = {
  fields: ['identity', 'markings'],
  sources: [
    mediaSource,
    noteSource,
    { kind: 'evidence_observation', evidence_observation_id: id(3), revision: '2' },
    { kind: 'observation_set', lot_id: id(4), version: '5' },
    { kind: 'inbox_item', inbox_item_id: id(20) },
  ],
}
const catalogue = {
  category: { choice: 'existing', reference: reference('category', 40), sources: [mediaSource] },
  parameters: [
    {
      name: 'Resistance',
      value: '1k',
      template: reference('parameter_template', 41),
      category_mapping: reference('category_parameter', 42),
      sources: [mediaSource],
    },
    {
      name: 'Tolerance',
      value: '1%',
      template: null,
      category_mapping: null,
      sources: [noteSource],
    },
  ],
  manufacturer: {
    company: {
      choice: 'proposed_new',
      name: 'Yageo',
      reason: 'Logo on the reel label.',
      sources: [mediaSource],
    },
    mpn: 'RC0603FR-071KL',
    sources: [mediaSource],
  },
  supplier: {
    company: { choice: 'existing', reference: reference('company', 43), sources: [noteSource] },
    sku: '311-1.00KHRCT-ND',
    price: { amount: '0.0123', currency: 'AUD' },
    sources: [noteSource],
  },
  description: { text: 'Thick film resistor, 0603, 1%.', sources: [mediaSource] },
}
const proposalV5 = {
  schema_version: 'bench-intake-proposal/5',
  subject_id: id(4),
  summary: 'A 0603 1k resistor reel from Yageo.',
  sources: [mediaSource],
  quantity: { value: '5000', status: 'estimated' },
  relies_on: relies,
  catalogue,
}

test('proposal /5 carries a structured catalogue block with sourced choices', () => {
  validate('ProcessingProposalV5', proposalV5)
  validate('ProcessingProposal', proposalV5)
  validate('ProcessingProposalV5', {
    ...proposalV5,
    catalogue: {
      ...catalogue,
      category: null,
      manufacturer: null,
      supplier: null,
      description: null,
      parameters: [],
    },
  })
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      quantity: { value: '5000', status: 'counted' },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      catalogue: { ...catalogue, category: { ...catalogue.category, sources: [] } },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      catalogue: {
        ...catalogue,
        category: { choice: 'proposed_new', name: 'Resistors', sources: [mediaSource] },
      },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV5', { ...proposalV5, relies_on: { ...relies, fields: [] } }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      relies_on: { ...relies, sources: [{ kind: 'operator_whim', id: id(1) }] },
    }),
  )
})

const selection = { provider: 'claude', authentication: 'subscription', model: 'claude-sonnet-5-5' }
const inputBase = {
  schema_version: 'bench-intake-input/6',
  batch_id: id(50),
  source_id: id(51),
  capture_revision: '9007199254740993',
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  notes: [],
  observations: [],
  profile_id: 'native-agent/2',
  instruction_version: 'native-agent/2',
  instruction_sha256: digest('d'),
  tool_profile_version: 'native-session-tools/1',
  media: { manifest: '{}', sha256: digest('e') },
  agent: selection,
  settings_revision: '3',
  pinned_proposal_ids: [],
}

test('input /6 separates the batch-level lead session from per-lot sessions', () => {
  validate('ProcessingInputV6', {
    ...inputBase,
    stage: 'examine',
    subject_id: null,
    subject: null,
    linked_part: null,
  })
  validate('ProcessingInputV6', {
    ...inputBase,
    profile_id: 'synthetic-session/1',
    instruction_version: 'synthetic-session/1',
    agent: null,
    settings_revision: null,
    stage: 'examine',
    subject_id: null,
    subject: null,
    linked_part: null,
  })
  assert.throws(() =>
    validate('ProcessingInputV6', {
      ...inputBase,
      stage: 'examine',
      subject_id: id(4),
      subject: null,
      linked_part: null,
    }),
  )
  assert.throws(() =>
    validate('ProcessingInputV6', {
      ...inputBase,
      stage: 'research',
      subject_id: null,
      subject: null,
      linked_part: null,
    }),
  )
  assert.throws(() =>
    validate('ProcessingInputV6', {
      ...inputBase,
      profile_id: 'native-agent/1',
      stage: 'examine',
      subject_id: null,
      subject: null,
      linked_part: null,
    }),
  )
})

test('earlier input versions still refuse the examine stage', () => {
  assert.throws(() => validate('ProcessingStage', 'examine'))
  validate('ProcessingStageV2', 'examine')
  validate('ProcessingStageV2', 'research')
  assert.throws(() => validate('ProcessingStageV2', 'sorting'))
})

test('command /5 binds the session handler', () => {
  const command = {
    schema_version: 'bench-intake-processing-command/5',
    job_id: id(60),
    attempt_id: id(61),
    input_id: id(62),
    input_sha256: digest('f'),
    profile_id: 'native-agent/2',
    handler_version: 'processing/5',
    command_id: id(63),
  }
  validate('ProcessingCommandV5', command)
  validate('ProcessingCommand', { ...command, profile_id: 'synthetic-session/1' })
  assert.throws(() =>
    validate('ProcessingCommandV5', { ...command, handler_version: 'processing/4' }),
  )
})

test('a lead job and its session have no subject', () => {
  validate('ProcessingJob', {
    id: id(70),
    subject_id: null,
    stage: 'examine',
    revision: '1',
    state: 'running',
    attempt_id: id(71),
    input_sha256: digest('a'),
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [],
    questions: [],
  })
  validate('AgentSessionList', {
    sessions: [
      {
        attempt_id: id(71),
        batch_id: id(50),
        job_id: id(70),
        subject_id: null,
        stage: 'examine',
        state: 'running',
        latest_on_job: true,
        selection,
        settings_revision: '3',
        queued_at: '2026-11-06T01:02:03.004Z',
        started_at: null,
        finished_at: null,
        native_session_id: null,
        actual_model: null,
        progress: 'responding',
        occupies_lane: true,
        session_state: 'running',
        latest_status: { text: 'Reading the label', at: '2026-11-06T01:02:04.000Z' },
      },
    ],
    next_before: null,
    sessions_supported: true,
  })
  validate('AgentSessionList', { sessions: [], next_before: null, sessions_supported: false })
  assert.throws(() => validate('AgentSessionList', { sessions: [], next_before: null }))
})

test('tool results report the pending inbox and typed errors', () => {
  validate('SessionToolResult', { ok: true, pending_inbox: 2, revision: '12' })
  validate('SessionToolResult', { ok: true, pending_inbox: 0 })
  validate('SessionToolResult', {
    ok: false,
    error: 'status_rate_limited',
    message: 'Status lines are limited to one every 2 seconds.',
    pending_inbox: 1,
  })
  assert.throws(() =>
    validate('SessionToolResult', { ok: false, error: 'oops', pending_inbox: 0, message: 'x' }),
  )
  validate('SessionReadInboxArgs', { after_seq: '0' })
  validate('SessionReplyArgs', { inbox_item_id: id(20), text: 'Thanks, updating the count.' })
  validate('SessionFetchEvidenceArgs', { evidence_id: id(11) })
  validate('SessionFetchEvidenceArgs', {
    evidence_id: id(11),
    version_id: id(12),
    page: 2,
    region: { x: 10, y: 20, width: 300, height: 200, source_width: 768, source_height: 512 },
  })
  validate('SessionProposeArgs', { proposal: proposalV5 })
})
