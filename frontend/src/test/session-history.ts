import {
  validate,
  type CatalogueProposalDto,
  type SessionHistoryAttemptDto,
  type SessionHistoryDto,
  type SessionHistoryEntryDto,
} from '@invimport/contracts'

/** Fixed identities for session history fixtures, valid under the contract's ID patterns. */
export const H = {
  batch: '10000000-0000-4000-8000-000000000001',
  lot: '20000000-0000-4000-8000-000000000002',
  job: '30000000-0000-4000-8000-000000000003',
  attempt: '40000000-0000-4000-8000-000000000004',
  attempt2: '40000000-0000-4000-8000-000000000044',
  question: '50000000-0000-4000-8000-000000000005',
  evidence: '60000000-0000-4000-8000-000000000006',
  version: '61000000-0000-4000-8000-000000000006',
  evidence2: '62000000-0000-4000-8000-000000000006',
  version2: '63000000-0000-4000-8000-000000000006',
  observation: '70000000-0000-4000-8000-000000000007',
  proposal: '80000000-0000-4000-8000-000000000008',
  part: '90000000-0000-4000-8000-000000000009',
  failure: 'a0000000-0000-4000-8000-00000000000a',
  inboxItem: 'b0000000-0000-4000-8000-00000000000b',
  instruction: 'c0000000-0000-4000-8000-00000000000c',
} as const

/** A minute of 24 November 2026, so entries sort by the minute they name. */
export function at(minute: number, second = 0) {
  return new Date(Date.UTC(2026, 10, 24, 2, minute, second)).toISOString()
}

export function attemptHeader(
  overrides: Partial<SessionHistoryAttemptDto> = {},
): SessionHistoryAttemptDto {
  return {
    id: H.attempt,
    number: 1,
    state: 'running',
    session_state: 'running',
    queued_at: at(1),
    started_because: 'first',
    profile_id: 'shared-vm-agent/3',
    runs_on: 'agent_vm',
    selection: { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' },
    actual_model: 'claude-opus-5-5',
    web: { public_pages: true, prefer_datasheets: true },
    ...overrides,
  }
}

type AgentEntry = Extract<SessionHistoryEntryDto, { who: 'agent' }>
type InputEntry = Extract<SessionHistoryEntryDto, { who: 'operator' | 'app' }>

/** An agent entry; `seq` orders it within its attempt. */
export function agent(
  seq: number,
  minute: number,
  details: AgentEntry['details'],
  extra: Partial<AgentEntry> = {},
): AgentEntry {
  const attempt = extra.attempt ?? 1
  return {
    id: `outbox:${attempt === 1 ? H.attempt : H.attempt2}:${seq}`,
    at: at(minute),
    who: 'agent',
    attempt,
    summary: details.kind === 'status' ? details.text : `Agent ${details.kind} ${seq}`,
    links: [],
    details,
    ...extra,
  }
}

export function input(
  seq: number,
  minute: number,
  details: InputEntry['details'],
  extra: Partial<InputEntry> = {},
): InputEntry {
  return {
    id: `inbox:${seq}`,
    at: at(minute),
    who: 'operator',
    read: true,
    summary: details.kind === 'chat' ? details.text : `Input ${details.kind} ${seq}`,
    links: [],
    details,
    ...extra,
  }
}

export const status = (seq: number, minute: number, text: string, extra?: Partial<AgentEntry>) =>
  agent(seq, minute, { kind: 'status', text }, { summary: text, ...extra })

export function observation(
  seq: number,
  minute: number,
  {
    id = H.observation,
    evidence = H.evidence,
    version = H.version,
    photo = 'Bench bag spill',
    text = '1N4148',
  }: { id?: string; evidence?: string; version?: string; photo?: string; text?: string } = {},
) {
  return agent(
    seq,
    minute,
    {
      kind: 'observation',
      current: {
        id,
        evidence_id: evidence,
        evidence_version_id: version,
        page: 1,
        region: {
          kind: 'pixels',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          source_width: 4000,
          source_height: 3000,
        },
        readings: { markings: [text], text: `“${text} ~200?”`, source_kind: 'handwriting' },
        visible_count: 9,
        status: 'active',
        lot_id: H.lot,
      },
    },
    {
      summary: `Recorded an observation in ${photo}`,
      links: [
        {
          kind: 'capture_evidence',
          evidence_id: evidence,
          version_id: version,
          page: 1,
          label: photo,
        },
        { kind: 'map', observation_id: id },
      ],
    },
  )
}

export function photoView(
  seq: number,
  minute: number,
  {
    evidence = H.evidence,
    version = H.version,
    photo = 'MCU close-up',
    region = true,
  }: { evidence?: string; version?: string; photo?: string; region?: boolean } = {},
  extra: Partial<AgentEntry> = {},
) {
  return agent(
    seq,
    minute,
    {
      kind: 'photo_view',
      view: {
        evidence_id: evidence,
        version_id: version,
        page: 1,
        ...(region ? { region: { x: 100, y: 200, width: 1024, height: 768 } } : {}),
        delivered: { width: 1024, height: 768, media_type: 'image/png', sha256: 'd'.repeat(64) },
      },
      crop: { attempt_id: extra.attempt === 2 ? H.attempt2 : H.attempt, seq: String(seq) },
    },
    {
      summary: `Prepared ${region ? 'part of ' : ''}${photo} for the agent`,
      links: [
        {
          kind: 'capture_evidence',
          evidence_id: evidence,
          version_id: version,
          page: 1,
          label: photo,
        },
      ],
      ...extra,
    },
  )
}

/** The photo every fixture proposal cites. */
export const citedPhoto = {
  kind: 'media_version',
  evidence_id: H.evidence,
  version_id: H.version,
  sha256: 'e'.repeat(64),
} as const

/** A proposal entry carrying a structured catalogue block. */
export function withCatalogue(
  entry: AgentEntry,
  catalogue: CatalogueProposalDto,
  extra: Partial<AgentEntry> = {},
): AgentEntry {
  if (entry.details.kind !== 'proposal') {
    throw new Error('withCatalogue needs a proposal entry')
  }
  const proposal = { ...entry.details.proposal, catalogue }
  return { ...entry, ...extra, details: { ...entry.details, proposal } }
}

const DATASHEET = 'https://ww1.microchip.com/downloads/ATmega328P.pdf'

/** A `/6` proposal citing one photo and the given web pages, with its derived web reads. */
export function proposal(
  seq: number,
  minute: number,
  {
    pages = [DATASHEET],
    summary = 'ATmega328P-AU',
    currentness = { state: 'current' } as Extract<
      AgentEntry['details'],
      { kind: 'proposal' }
    >['currentness'],
    lotLink = { kind: 'lot', lot_id: H.lot, label: 'ATmega328P' } as AgentEntry['links'][number],
  } = {},
): AgentEntry[] {
  const id = `outbox:${H.attempt}:${seq}`
  const media = citedPhoto
  const entry = agent(
    seq,
    minute,
    {
      kind: 'proposal',
      proposal_id: H.proposal,
      proposal: {
        schema_version: 'bench-intake-proposal/6',
        subject_id: H.lot,
        summary,
        sources: [media, ...pages.map((url) => ({ kind: 'web_page' as const, url }))],
        relies_on: { fields: ['identity'], sources: [media] },
      },
      currentness,
    },
    {
      summary: `Proposed ${summary}${currentness.state === 'current' ? '' : ` · ${currentness.state}`}`,
      links: [
        lotLink,
        {
          kind: 'capture_evidence',
          evidence_id: H.evidence,
          version_id: H.version,
          page: 1,
          label: 'MCU close-up',
        },
        ...pages.map((url) => ({
          kind: 'external_url' as const,
          url,
          label: new URL(url).hostname,
        })),
        ...(currentness.state === 'provisional'
          ? currentness.question_ids.map((question) => ({
              kind: 'question' as const,
              question_id: question,
              label: 'Which ATmega328P variant is this?',
            }))
          : []),
      ],
    },
  )
  const reads = pages.map((url, index) =>
    agent(
      seq,
      minute,
      { kind: 'web_read', url, proposal_entry_id: id },
      {
        id: `${id}:web:${index + 1}`,
        summary: `Read ${new URL(url).hostname}`,
        links: [{ kind: 'external_url', url, label: new URL(url).hostname }],
      },
    ),
  )
  // The read lists derived web reads straight after their proposal, newest first.
  return [entry, ...reads]
}

export function question(
  seq: number,
  minute: number,
  {
    state = 'open',
    id = H.question,
  }: { state?: 'open' | 'answered' | 'superseded'; id?: string } = {},
) {
  return agent(
    seq,
    minute,
    {
      kind: 'question',
      question_id: id,
      state,
      question: {
        schema_version: 'bench-intake-question/2',
        subject_id: H.lot,
        reason: 'The top marking is worn.',
        fields: ['identity'],
        steps: [
          {
            id: 'variant',
            prompt: 'Which ATmega328P variant is this?',
            assumption: 'ATmega328P-AU',
            answer: {
              kind: 'choice',
              options: [
                { id: 'p', label: 'ATmega328P-AU' },
                { id: 'pb', label: 'ATmega328PB-AU' },
              ],
              other: true,
            },
          },
        ],
      },
    },
    {
      summary: 'Asked: Which ATmega328P variant is this?',
      links: [
        { kind: 'question', question_id: id, label: 'Which ATmega328P variant is this?' },
        { kind: 'lot', lot_id: H.lot, label: 'ATmega328P' },
      ],
    },
  )
}

export const chat = (seq: number, minute: number, text: string, extra?: Partial<InputEntry>) =>
  input(seq, minute, { kind: 'chat', text }, { summary: text, ...extra })

export const reply = (seq: number, minute: number, text: string) =>
  agent(
    seq,
    minute,
    { kind: 'reply', inbox_item_id: H.inboxItem, text },
    { summary: `Replied: ${text}` },
  )

/** A history page, newest first, validated as the server would send it. */
export function history(
  entries: SessionHistoryEntryDto[],
  {
    before,
    attempts = [attemptHeader()],
    acked = '100',
  }: { before?: string; attempts?: SessionHistoryAttemptDto[]; acked?: string } = {},
): SessionHistoryDto {
  // The read lists attempts newest first, as the server does.
  const newestFirst = [...attempts].sort((a, b) => b.number - a.number)
  const page: SessionHistoryDto = {
    session: {
      job_id: H.job,
      batch_id: H.batch,
      stage: 'research',
      subject_id: H.lot,
      current_attempt_id: newestFirst[0].id,
      attempts: newestFirst,
      inbox_acked_seq: acked,
    },
    entries,
    ...(before ? { before } : {}),
  }
  validate('SessionHistory', page)
  return page
}
