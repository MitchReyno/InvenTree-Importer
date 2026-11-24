import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, webPageUrlAccepted } from '../src/index.ts'

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
  photo_view: {
    evidence_id: id(11),
    version_id: id(12),
    page: 1,
    region: { x: 10, y: 20, width: 300, height: 400 },
    delivered: { width: 300, height: 400, media_type: 'image/png', sha256: digest('f') },
  },
}

test('the outbox carries exactly eight kinds of item', () => {
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

test('a photo view records what was cut and prepared, never the image bytes', () => {
  const view = outboxPayloads.photo_view as Record<string, unknown>
  const { region: _region, ...wholePage } = view
  validate('SessionPhotoView', wholePage)
  validate('SessionOutboxItem', { ...outboxBase, kind: 'photo_view', payload: wholePage })
  assert.throws(() => validate('SessionPhotoView', { ...view, base64: 'iVBORw0KGgo=' }))
  assert.throws(() =>
    validate('SessionPhotoView', {
      ...view,
      delivered: { ...(view.delivered as object), media_type: 'image/webp' },
    }),
  )
  const { delivered: _delivered, ...undelivered } = view
  assert.throws(() => validate('SessionPhotoView', undelivered))
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

const webPage = {
  kind: 'web_page',
  url: 'https://www.yageo.com/upload/media/product/RC0603.pdf',
  title: 'RC0603 datasheet',
  read_at: '2026-11-23T04:05:06.007Z',
}
const proposalV6 = {
  ...proposalV5,
  schema_version: 'bench-intake-proposal/6',
  sources: [mediaSource, webPage],
}

test('proposal /6 may cite an agent-reported web page in its top-level sources only', () => {
  validate('ProcessingProposalV6', proposalV6)
  validate('ProcessingProposal', proposalV6)
  validate('SessionProposeArgs', { proposal: proposalV6 })
  validate('SessionProposeArgs', { proposal: proposalV5 })
  validate('ProcessingProposalV6', {
    ...proposalV6,
    sources: [{ kind: 'web_page', url: 'http://example.com' }],
  })
  // `/5` stays exact.
  assert.throws(() => validate('ProcessingProposalV5', { ...proposalV5, sources: [webPage] }))
  assert.throws(() =>
    validate('ProcessingProposalV6', {
      ...proposalV6,
      relies_on: { ...relies, sources: [webPage] },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV6', {
      ...proposalV6,
      catalogue: { ...catalogue, category: { ...catalogue.category, sources: [webPage] } },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV6', {
      ...proposalV6,
      sources: [{ ...webPage, saved_copy: 'yes' }],
    }),
  )
})

test('a web page source is an absolute http(s) URL of at most 2048 characters, without credentials', () => {
  const accepts = (url: string) => {
    validate('WebPageSource', { kind: 'web_page', url })
    assert.equal(webPageUrlAccepted(url), true, url)
  }
  const refuses = (url: string) => {
    assert.throws(() => validate('WebPageSource', { kind: 'web_page', url }), url)
    assert.equal(webPageUrlAccepted(url), false, url)
  }
  accepts('https://example.com/datasheet.pdf?rev=2#page=3')
  accepts('http://example.com')
  accepts('HTTPS://EXAMPLE.COM/path/with@sign')
  accepts(`https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`)
  refuses(`https://example.com/${'a'.repeat(2049 - 'https://example.com/'.length)}`)
  // The limit counts characters as JSON Schema does: code points, not UTF-16 code units.
  const base = 'https://example.com/'
  accepts(`${base}${'\u{1F4C4}'.repeat(2048 - base.length)}`)
  refuses(`${base}${'\u{1F4C4}'.repeat(2049 - base.length)}`)
  refuses('file:///etc/passwd')
  refuses('ftp://example.com/file')
  refuses('javascript:alert(1)')
  refuses('//example.com/relative')
  refuses('/datasheet.pdf')
  refuses('https://user:secret@example.com/')
  refuses('https://token@example.com/')
  refuses('https://example.com/a b')
  refuses('https://example.com/\nnext')
  refuses('https://exa\\mple.com/')
  // The pattern can't see an empty host; the parser can.
  assert.equal(webPageUrlAccepted('https://:443/'), false)
  assert.throws(() => validate('WebPageSource', { ...webPage, read_at: 'yesterday' }))
  assert.throws(() => validate('WebPageSource', { ...webPage, title: '' }))
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
  validate('SessionToolResult', {
    ok: false,
    error: 'outcome_uncertain',
    message: 'The image was withheld because recording the view was not confirmed.',
    pending_inbox: 0,
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

test('a question keeps when it was asked, and an older question without the time stays readable', () => {
  const question = {
    id: id(1),
    job_id: id(2),
    attempt_id: id(3),
    input_sha256: digest('a'),
    revision: '1',
    state: 'open',
    subject_id: id(4),
    spec: { kind: 'quantity', prompt: 'How many?', reason: 'Torn label.' },
  }
  validate('ProcessingQuestion', question)
  validate('ProcessingQuestion', { ...question, asked_at: '2026-11-08T04:30:24.952Z' })
  assert.throws(() => validate('ProcessingQuestion', { ...question, asked_at: '' }))
  assert.throws(() => validate('ProcessingQuestion', { ...question, asked_at: 'yesterday' }))
})

test('readings and catalogue values may say what kind of source they came from and how well it agrees', () => {
  const said = { source_kind: 'packing_slip', agreement: 'disagree' }
  validate('ProcessingProposalV5', {
    ...proposalV5,
    catalogue: {
      ...catalogue,
      category: { ...catalogue.category, ...said },
      parameters: catalogue.parameters.map((item) => ({
        ...item,
        source_kind: 'label',
        agreement: 'read',
      })),
      manufacturer: {
        ...catalogue.manufacturer,
        source_kind: 'distributor_page',
        agreement: 'likely',
      },
      description: {
        text: 'Thick film resistor',
        sources: [mediaSource],
        source_kind: 'handwriting',
      },
    },
  })
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      catalogue: { ...catalogue, category: { ...catalogue.category, source_kind: 'rumour' } },
    }),
  )
  assert.throws(() =>
    validate('ProcessingProposalV5', {
      ...proposalV5,
      catalogue: { ...catalogue, category: { ...catalogue.category, agreement: 'certain' } },
    }),
  )

  const region = {
    kind: 'pixels',
    x: 1,
    y: 1,
    width: 10,
    height: 10,
    source_width: 100,
    source_height: 100,
  }
  const args = {
    base_revision: '1',
    evidence_version_id: id(12),
    region,
    readings: { markings: ['BC547'] },
  }
  validate('RecordObservationArgs', args)
  validate('RecordObservationArgs', {
    ...args,
    readings: { markings: ['BC547'], source_kind: 'label', agreement: 'likely' },
  })
  assert.throws(() =>
    validate('RecordObservationArgs', {
      ...args,
      readings: { markings: ['BC547'], source_kind: 'photo' },
    }),
  )
})

test('a regroup records its moves with their source lots and outcomes; an older one only its lots', () => {
  const moves = [
    { observation_id: id(30), from_lot_id: id(4), to_lot_id: id(5), outcome: 'applied' },
    { observation_id: id(31), from_lot_id: null, to_lot_id: id(5), outcome: 'suggested' },
    { observation_id: id(32), from_lot_id: id(5), to_lot_id: id(5), outcome: 'unchanged' },
  ]
  validate('SessionOutboxItem', {
    ...outboxBase,
    kind: 'regroup',
    payload: { lot_ids: [id(5)], moves },
  })
  validate('SessionOutboxItem', { ...outboxBase, kind: 'regroup', payload: { lot_ids: [id(5)] } })
  // A lot item may say what propose_lot did and why the lot is apart; an older one has only the lot.
  for (const outcome of ['formed', 'extended', 'suggested', 'unchanged']) {
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'lot',
      payload: { lot_id: id(4), outcome },
    })
  }
  validate('SessionOutboxItem', {
    ...outboxBase,
    kind: 'lot',
    payload: { lot_id: id(4), outcome: 'formed', separation_reason: 'Date code 2407 vs 2341' },
  })
  assert.throws(() =>
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'lot',
      payload: { lot_id: id(4), separation_reason: '' },
    }),
  )
  validate('ProposeLotArgs', {
    base_revision: '1',
    label: 'Packet B',
    observation_ids: [id(30)],
    separation_reason: 'Same MPN as packet A, another date code',
  })
  assert.throws(() =>
    validate('ProposeLotArgs', {
      base_revision: '1',
      label: 'Packet B',
      observation_ids: [id(30)],
      separation_reason: 'x'.repeat(513),
    }),
  )
  assert.throws(() =>
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'lot',
      payload: { lot_id: id(4), outcome: 'merged' },
    }),
  )
  assert.throws(() =>
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'regroup',
      payload: { lot_ids: [id(5)], moves: [{ ...moves[0], outcome: 'pending' }] },
    }),
  )
  assert.throws(() =>
    validate('SessionOutboxItem', {
      ...outboxBase,
      kind: 'regroup',
      payload: { lot_ids: [id(5)], moves: [] },
    }),
  )
})

const historyAttempt = {
  id: id(40),
  number: 1,
  state: 'ready',
  session_state: 'finished',
  queued_at: '2026-11-06T01:02:03.004Z',
  ended: { at: '2026-11-06T01:12:03.004Z', source: 'transition' },
  started_because: 'first',
  profile_id: 'shared-vm-agent/3',
  runs_on: 'agent_vm',
  selection: { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' },
  actual_model: null,
  web: { public_pages: true, prefer_datasheets: true },
}
const historyPage = (entries: unknown[], extra: object = {}) => ({
  session: {
    job_id: id(41),
    batch_id: id(42),
    stage: 'research',
    subject_id: id(4),
    current_attempt_id: id(40),
    attempts: [historyAttempt],
    inbox_acked_seq: '0',
  },
  entries,
  ...extra,
})

test('a history page carries resolved entries, the session metadata and one older cursor', () => {
  const status = {
    id: `outbox:${id(40)}:1`,
    at: '2026-11-06T01:02:04.000Z',
    who: 'agent',
    attempt: 1,
    summary: 'Reading the reel label',
    links: [],
    details: { kind: 'status', text: 'Reading the reel label' },
  }
  const chat = {
    id: 'inbox:3',
    at: '2026-11-06T01:02:05.000Z',
    who: 'operator',
    read: false,
    summary: 'Check the datasheet first',
    links: [{ kind: 'gone', target: 'lot', label: 'Lot retired' }],
    details: { kind: 'chat', text: 'Check the datasheet first' },
  }
  const webRead = {
    ...status,
    id: `outbox:${id(40)}:2:web:3`,
    summary: 'Read ATmega328P datasheet',
    links: [
      { kind: 'external_url', url: 'https://example.com/ds.pdf', label: 'ATmega328P datasheet' },
    ],
    details: {
      kind: 'web_read',
      url: 'https://example.com/ds.pdf',
      proposal_entry_id: `outbox:${id(40)}:2`,
    },
  }
  validate('SessionHistory', historyPage([chat, webRead, status], { before: 'WyIyMDI2Il0' }))
  validate('SessionHistory', historyPage([]))
  // Every attempt is listed, however many a lineage has.
  const many = Array.from({ length: 1001 }, (_, index) => ({
    ...historyAttempt,
    number: index + 1,
  }))
  validate('SessionHistory', {
    ...historyPage([]),
    session: { ...historyPage([]).session, attempts: many },
  })
  // An inbox entry has no attempt, and an agent entry has no read state.
  assert.throws(() => validate('SessionHistory', historyPage([{ ...chat, attempt: 1 }])))
  assert.throws(() => validate('SessionHistory', historyPage([{ ...status, read: true }])))
  assert.throws(() => validate('SessionHistory', historyPage([{ ...status, id: 'outbox:1' }])))
  assert.throws(() => validate('SessionHistory', historyPage([], { before: 'not a cursor' })))
  assert.throws(() =>
    validate('SessionHistory', {
      ...historyPage([]),
      session: { ...historyPage([]).session, attempts: [] },
    }),
  )
})
