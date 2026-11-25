import type {
  BatchActivityDto,
  ProcessingJobDto,
  SessionHistoryAttemptDto,
  SessionHistoryDto,
  SessionHistoryEntryDto,
} from '@invimport/contracts'

/** Session histories for the Processing fixture page, so the drawer and session page show. */

type Ids = { batchId: string; id: (n: number) => string; lot: (n: number) => string }
type Entry = SessionHistoryEntryDto

const at = (minute: number) => `2026-11-06T08:${String(minute).padStart(2, '0')}:00.000Z`

function attempt(ids: Ids, n: number, number: number, extra: Partial<SessionHistoryAttemptDto>) {
  return {
    id: ids.id(n),
    number,
    state: 'running',
    session_state: 'running',
    queued_at: at(number === 1 ? 0 : 10),
    started_because: number === 1 ? 'first' : null,
    profile_id: 'shared-vm-agent/3',
    runs_on: 'agent_vm',
    selection: { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' },
    actual_model: 'claude-opus-5-5',
    web: { public_pages: true, prefer_datasheets: true },
    ...extra,
  } as SessionHistoryAttemptDto
}

/** The failed Images job's three attempts, newest first: two refused setups, then an overload. */
function retriedAttempts(ids: Ids): SessionHistoryAttemptDto[] {
  const refused = (n: number) => ({
    id: ids.id(n),
    category: 'configuration' as const,
    summary: 'The native session configuration was not accepted.',
    recovery: 'Check the supported CLI version and configuration.',
    details_available: false,
    cause: { code: 'agent_admission_unavailable' as const, provider: 'claude' as const },
  })

  return [
    attempt(ids, 24, 3, { state: 'failed', session_state: 'failed' }),
    attempt(ids, 42, 2, {
      state: 'superseded',
      session_state: 'failed',
      ended: { at: '2026-11-06T07:25:00.000Z', source: 'transition' },
      failure: refused(93),
    }),
    attempt(ids, 41, 1, {
      state: 'superseded',
      session_state: 'failed',
      ended: { at: '2026-11-06T07:15:00.000Z', source: 'transition' },
      failure: refused(94),
    }),
  ]
}

function photoLink(ids: Ids) {
  return {
    kind: 'capture_evidence' as const,
    evidence_id: ids.id(70),
    version_id: ids.id(71),
    page: 1,
    label: 'Bench bag spill',
  }
}

function agentEntry(
  attemptId: string,
  number: number,
  seq: number,
  minute: number,
  summary: string,
  details: Entry['details'],
  links: Entry['links'] = [],
): Entry {
  return {
    id: `outbox:${attemptId}:${seq}`,
    at: at(minute),
    who: 'agent',
    attempt: number,
    summary,
    links,
    details,
  }
}

function photoView(ids: Ids, attemptId: string, number: number, seq: number, minute: number) {
  return agentEntry(
    attemptId,
    number,
    seq,
    minute,
    'Prepared part of Bench bag spill for the agent',
    {
      kind: 'photo_view',
      view: {
        evidence_id: ids.id(70),
        version_id: ids.id(71),
        page: 1,
        region: { x: 820, y: 440, width: 1024, height: 768 },
        delivered: { width: 1024, height: 768, media_type: 'image/png', sha256: 'd'.repeat(64) },
      },
      crop: null,
    },
    [photoLink(ids)],
  )
}

/** The Research session for the LM358 tube: two attempts, older entries on a second page. */
function researchPages(ids: Ids) {
  const first = ids.id(23)
  const second = ids.id(33)
  const lotLink = { kind: 'lot' as const, lot_id: ids.lot(3), label: 'LM358 op-amp tube' }
  const datasheet = 'https://www.ti.com/lit/ds/symlink/lm358.pdf'
  const listing = 'https://www.mouser.com/ProductDetail/595-LM358P'
  const proposalId = `outbox:${second}:3`
  const media = {
    kind: 'media_version' as const,
    evidence_id: ids.id(70),
    version_id: ids.id(71),
    sha256: 'e'.repeat(64),
  }
  const proposal = agentEntry(
    second,
    2,
    3,
    14,
    'Proposed LM358P dual op-amp, DIP-8 · provisional',
    {
      kind: 'proposal',
      proposal_id: ids.id(60),
      proposal: {
        schema_version: 'bench-intake-proposal/6',
        subject_id: ids.lot(3),
        summary: 'LM358P dual op-amp, DIP-8, Texas Instruments',
        sources: [
          media,
          { kind: 'web_page', url: datasheet, title: 'LM358 datasheet (TI)' },
          { kind: 'web_page', url: listing },
        ],
        relies_on: { fields: ['identity'], sources: [media] },
      },
      currentness: { state: 'provisional', question_ids: [ids.id(61)] },
    },
    [
      lotLink,
      photoLink(ids),
      { kind: 'external_url', url: datasheet, label: 'LM358 datasheet (TI)' },
      { kind: 'external_url', url: listing, label: 'www.mouser.com' },
      { kind: 'question', question_id: ids.id(61), label: 'How many are in the tube?' },
    ],
  )

  const webRead = (index: number, url: string, label: string): Entry => ({
    ...proposal,
    id: `${proposalId}:web:${index}`,
    summary: `Read ${label}`,
    links: [{ kind: 'external_url', url, label }],
    details: { kind: 'web_read', url, proposal_entry_id: proposalId },
  })

  const newest: Entry[] = [
    agentEntry(second, 2, 5, 17, 'Checking whether the tube holds 50 or 40', {
      kind: 'status',
      text: 'Checking whether the tube holds 50 or 40',
    }),
    agentEntry(second, 2, 4, 16, 'Replied: The TI print code matches; I’ll check the count next.', {
      kind: 'reply',
      inbox_item_id: ids.id(62),
      text: 'The TI print code matches; I’ll check the count next.',
    }),
    {
      id: 'inbox:3',
      at: at(15),
      who: 'operator',
      read: true,
      summary: 'Is the TI print code the same as the datasheet?',
      links: [],
      details: { kind: 'chat', text: 'Is the TI print code the same as the datasheet?' },
    },
    proposal,
    webRead(2, listing, 'www.mouser.com'),
    webRead(1, datasheet, 'LM358 datasheet (TI)'),
    photoView(ids, second, 2, 2, 12),
    {
      id: 'inbox:2',
      at: at(9),
      who: 'app',
      read: true,
      summary: 'Revision: The tube label reads LM358P, not LM358N',
      links: [],
      details: {
        kind: 'revision',
        fields: ['identity'],
        reason: 'The tube label reads LM358P, not LM358N',
      },
    },
  ]
  const older: Entry[] = [
    agentEntry(first, 1, 3, 6, 'Reading the tube label', {
      kind: 'status',
      text: 'Reading the tube label',
    }),
    photoView(ids, first, 1, 2, 4),
    photoView(ids, first, 1, 1, 3),
    {
      id: 'inbox:1',
      at: at(1),
      who: 'operator',
      read: true,
      summary: 'Instruction: Prefer manufacturer datasheets over distributor pages.',
      links: [],
      details: {
        kind: 'instruction',
        instruction_id: ids.id(63),
        text: 'Prefer manufacturer datasheets over distributor pages.',
        group_id: null,
        saved_at: at(0),
        relayed: false,
      },
    },
  ]
  const session = {
    job_id: ids.id(3),
    batch_id: ids.batchId,
    stage: 'research' as const,
    subject_id: ids.lot(3),
    current_attempt_id: second,
    // Newest first, as the read lists them.
    attempts: [
      attempt(ids, 33, 2, {}),
      attempt(ids, 23, 1, {
        state: 'failed',
        session_state: 'failed',
        ended: { at: at(8), source: 'transition' },
        failure: {
          id: ids.id(64),
          category: 'provider_network',
          summary: 'The provider connection or protocol failed.',
          recovery: 'Check provider availability, then start a fresh session.',
          details_available: false,
        },
      }),
    ],
    inbox_acked_seq: '3',
  }
  return {
    newest: { session, entries: newest, before: 'older-page' } as SessionHistoryDto,
    older: { session, entries: older } as SessionHistoryDto,
  }
}

/**
 * Any other session. The ATmega Examine session (job 2) recorded three observations in one
 * photo, grouped in the drawer; the others have only their status line.
 */
function otherHistory(ids: Ids, jobId: string): SessionHistoryDto {
  const attemptId = ids.id(20 + Number(jobId.slice(-2)))

  const observation = (seq: number, reading: string): Entry =>
    agentEntry(
      attemptId,
      1,
      seq,
      seq,
      'Recorded an observation in Bench bag spill',
      {
        kind: 'observation',
        current: {
          id: ids.id(40 + seq),
          evidence_id: ids.id(70),
          evidence_version_id: ids.id(71),
          page: 1,
          region: {
            kind: 'pixels',
            x: 100 * seq,
            y: 80,
            width: 300,
            height: 200,
            source_width: 4000,
            source_height: 3000,
          },
          readings: { markings: [reading], text: reading, source_kind: 'label' },
          visible_count: 3,
          status: 'active',
          lot_id: ids.lot(2),
        },
      },
      [photoLink(ids), { kind: 'map', observation_id: ids.id(40 + seq) }],
    )

  return {
    session: {
      job_id: jobId,
      batch_id: ids.batchId,
      stage: 'examine',
      subject_id: ids.lot(2),
      current_attempt_id: attemptId,
      attempts:
        jobId === ids.id(4)
          ? retriedAttempts(ids)
          : [attempt(ids, 20 + Number(jobId.slice(-2)), 1, { state: 'waiting_for_user' })],
      inbox_acked_seq: '0',
      start_fresh:
        jobId === ids.id(4)
          ? { allowed: true }
          : { allowed: false, reason: 'session_not_replaceable' },
    },
    entries: [
      agentEntry(attemptId, 1, 4, 5, 'Asked about the last letter', {
        kind: 'status',
        text: 'Asked about the last letter',
      }),
      ...(jobId === ids.id(2)
        ? [observation(3, 'ATMEGA328P'), observation(2, '2341'), observation(1, 'AU')]
        : []),
    ],
  }
}

/**
 * The Examine lead session as the drawer shows it: actions with a message and its reply between
 * them, and the operator's answer once one is given.
 */
function examineHistory(ids: Ids, answer: Entry | undefined): SessionHistoryDto {
  const attemptId = ids.id(25)

  const step = (seq: number, minute: number, text: string) =>
    agentEntry(attemptId, 1, seq, minute, text, { kind: 'status', text })

  const entries: Entry[] = [
    step(6, 16, 'Checking whether packet A’s two photos show one bag'),
    ...(answer ? [answer] : []),
    step(5, 14, 'Formed 10 kΩ resistor 0603, packet B'),
    agentEntry(attemptId, 1, 4, 13, 'Replied: Thanks, I’ll keep them apart.', {
      kind: 'reply',
      inbox_item_id: ids.id(62),
      text: 'Thanks, I’ll keep them apart.',
    }),
    {
      id: 'inbox:1',
      at: at(13),
      who: 'operator',
      read: true,
      summary: 'The two resistor packets are separate purchases.',
      links: [],
      details: { kind: 'chat', text: 'The two resistor packets are separate purchases.' },
    },
    photoView(ids, attemptId, 1, 3, 12),
    step(2, 11, 'Recorded 10 observations in Bench bag spill'),
    step(1, 10, 'Formed 10 kΩ resistor 0603, packet A'),
  ]

  return {
    session: {
      job_id: ids.id(5),
      batch_id: ids.batchId,
      stage: 'examine',
      subject_id: null,
      current_attempt_id: attemptId,
      attempts: [attempt(ids, 25, 1, {})],
      inbox_acked_seq: '1',
      start_fresh: { allowed: false, reason: 'session_not_replaceable' },
    },
    entries,
  } as SessionHistoryDto
}

/**
 * The fixture's history read: the Research job pages, the Examine lead with any answer given,
 * every other job one page.
 */
export function fixtureHistory(ids: Ids, examineAnswer: () => Entry | undefined = () => undefined) {
  return async (_batch: string, jobId: string, before?: string) => {
    if (jobId === ids.id(5)) {
      return examineHistory(ids, examineAnswer())
    }
    if (jobId !== ids.id(3)) {
      return otherHistory(ids, jobId)
    }
    const pages = researchPages(ids)
    return before ? pages.older : pages.newest
  }
}

/** The recorded actions the batch activity read sends; status lines become notes instead. */
const ACTIONS = new Set(['observation', 'lot', 'regroup', 'proposal', 'question', 'answer'])

/**
 * Processing's recent activity across every session job of the fixture, built the way the server
 * builds it: each job's recorded actions from its history, newest first and at most six, with the
 * job's stage, subject and latest status line from the job itself.
 */
export function fixtureActivity(
  read: ReturnType<typeof fixtureHistory>,
  sessionJobs: () => Promise<readonly ProcessingJobDto[]>,
) {
  return async (batchId: string): Promise<BatchActivityDto> => {
    const jobs = await sessionJobs()
    const histories = await Promise.all(jobs.map((job) => read(batchId, job.id)))
    const entries = histories.flatMap((history, index) => {
      const job = jobs[index]
      return history.entries
        .filter((entry) => ACTIONS.has(entry.details.kind))
        .map((entry) => ({
          job_id: job.id,
          stage: job.stage,
          subject_id: job.subject_id,
          entry,
          agent_note: job.latest_status ?? null,
        }))
    })
    entries.sort((a, b) => b.entry.at.localeCompare(a.entry.at))
    return { entries: entries.slice(0, 6) }
  }
}
