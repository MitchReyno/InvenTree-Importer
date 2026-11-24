import type {
  AgentSettingsDto,
  BatchAttentionDto,
  SessionFailureDto,
  AgentSessionDto,
  CaptureSnapshotDto,
  ProcessingAnswerDto,
  ProcessingQuestionDto,
  ProcessingSnapshotDto,
  SessionHistoryEntryDto,
} from '@invimport/contracts'
import { useState } from 'react'
import { createAnswerOutcomes, sentAnswerValues } from '#/processing/answer-outcomes'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { AgentSessions } from '#/components/agents/AgentSessions'
import { fixtureHistory } from './session-history'
import { sessionList, sessionRow } from '#/test/agent-sessions'
import { heyyySessions, HEYYY_LOT, HEYYY_NAMES } from '#/components/agents/fixtures/heyyy'
import { ProcessingWorkspace } from '#/components/processing/ProcessingWorkspace'
import { Main, PageContent } from '#/components/AppLayout'
import { useInstructionDelivery } from '#/processing/instruction-delivery'
import { useHashRoute } from '#/navigation/useHashRoute'
import { lotFromQuery, parseBatchRoute } from '#/navigation/batch-route'
import { ApiClientsProvider } from '#/context'
import { RefreshSignal } from '#/components/operations/RefreshSignal'

/** Owned browser fixture: synthetic clients only, no API, provider or InvenTree traffic. */
const scope = {
  origin: location.origin,
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: 'b0000000-0000-4000-8000-00000000000b',
  targetContextId: '40000000-0000-4000-8000-000000000004',
}
const batchId = '10000000-0000-4000-8000-000000000001'
/** `?read-delay-ms=5000` holds each Processing read, to show a slow refresh. */
const READ_DELAY_MS = Number(new URLSearchParams(location.search).get('read-delay-ms') ?? '0')

const lot = (n: number) => `50000000-0000-4000-8000-00000000000${n}`

const id = (n: number) => `60000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const names = ['10 kΩ resistor 0603 — packet A', 'ATmega328P microcontroller', 'LM358 op-amp tube']

const batch = {
  id: batchId,
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  title: 'Mouser 3381-22 + bench bag',
  revision: '7',
  archived: false,
  updated_at: '2026-11-06T09:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  parts: [],
  lots: names.map((label, index) => ({
    id: lot(index + 1),
    label,
    revision: '1',
    contribution_key: id(80 + index),
    part_subject_id: null,
    quantity: { mode: 'unknown' },
    location: { mode: 'inherit' },
  })),
  notes: [],
  observations: [],
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: '0' },
} as unknown as CaptureSnapshotDto

function job(n: number, stage: string, state: string, subject: string | null, extra = {}) {
  return {
    id: id(n),
    subject_id: subject,
    stage,
    revision: '1',
    state,
    attempt_id: id(n + 20),
    input_sha256: 'a'.repeat(64),
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [],
    questions: [],
    ...extra,
  }
}

const question = (n: number, subject: string, prompt: string, assumption?: string) => ({
  id: id(n + 40),
  job_id: id(n),
  attempt_id: id(n + 20),
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: 'open',
  subject_id: subject,
  spec: { kind: 'clarification', prompt, reason: 'The marking is worn.' },
  ...(assumption ? { assumption } : {}),
})

/** Questions answered in this fixture; an answer is accepted and the next read shows it. */
const answered = new Set<string>()

/** How long the fixture's lead session takes to read an answer from its inbox. */
const READ_AFTER_MS = 8000

/** Each answer given here, with when the lead session read it. */
const given = new Map<string, { input: ProcessingAnswerDto; at: string; readAt?: string }>()

const askedState = (questionId: string) => (answered.has(questionId) ? 'answered' : 'open')

/** The read's answer summary for a question answered in this fixture. */
function answerSummary(question: ProcessingQuestionDto) {
  const answer = given.get(question.id)
  if (!answer) {
    return {}
  }
  return {
    revision: '2',
    answer: {
      answer_id: id(95),
      answered_at: answer.at,
      values: sentAnswerValues(question, answer.input),
      effects: [{ kind: 'note', subject_id: question.subject_id }],
      delivery: answer.readAt
        ? { state: 'read', read_at: answer.readAt }
        : { state: 'waiting', read_at: null },
    },
    session_history: true,
  }
}

/** The answer as the lead session's history lists it, once given. */
function examineAnswerEntry(): SessionHistoryEntryDto | undefined {
  const question = steppedQuestion() as unknown as ProcessingQuestionDto
  const answer = given.get(question.id)
  if (!answer || answer.input.schema_version !== 'bench-intake-answer/2') {
    return undefined
  }
  const steps = answer.input.steps
  const summary = sentAnswerValues(question, answer.input)
  return {
    id: 'inbox:2',
    at: answer.at,
    who: 'operator',
    read: answer.readAt !== undefined,
    summary: `You answered: ${summary.map((value) => value.text).join(' · ')}`,
    links: [{ kind: 'question', question_id: question.id, label: 'About the 10 kΩ packets' }],
    details: {
      kind: 'answer',
      answer: {
        question_id: question.id,
        answer_id: id(95),
        steps: steps.map((step, index) => ({
          step_id: step.step_id,
          value:
            step.value.kind === 'choice' && 'option_id' in step.value
              ? { ...step.value, label: summary[index]?.text ?? step.value.option_id }
              : step.value,
        })),
      },
      effects: [{ kind: 'note', subject_id: lot(1) }],
    },
  } as SessionHistoryEntryDto
}

/** The lead session's three related steps about two resistor packets. */
const steppedQuestion = () => ({
  id: id(45),
  job_id: id(5),
  attempt_id: id(25),
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: askedState(id(45)),
  subject_id: lot(1),
  session_history: true,
  schema_version: 'bench-intake-question/2',
  fields: ['identity', 'quantity'],
  title: 'About the 10 kΩ packets',
  reason: 'Same MPN on both labels, but the date codes differ (2341 and 2407).',
  asked_at: '2026-11-06T09:02:00.000Z',
  steps: [
    {
      id: 'same_part',
      prompt: 'Are packets A and B the same Part?',
      assumption: 'Treating them as the same Part.',
      answer: {
        kind: 'choice',
        options: [
          { id: 'same', label: 'Yes, same Part', detail: 'RES-0144, two lots' },
          { id: 'different', label: 'No, different Parts' },
        ],
        other: true,
      },
    },
    {
      id: 'left',
      prompt: 'How many are left in packet B?',
      assumption: 'An estimated 380, from the “~380 left” label.',
      answer: { kind: 'number' },
    },
    {
      id: 'place',
      prompt: 'Where should packet B go?',
      assumption: 'Drawer R3, with packet A.',
      answer: {
        kind: 'choice',
        options: [
          { id: 'r3', label: 'Drawer R3', detail: 'with packet A' },
          { id: 'r4', label: 'Drawer R4' },
        ],
        other: true,
      },
    },
  ],
})

/** Research's one-step choice between two variants. */
const choiceQuestion = () => ({
  id: id(46),
  job_id: id(6),
  attempt_id: id(26),
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: askedState(id(46)),
  subject_id: lot(2),
  schema_version: 'bench-intake-question/2',
  fields: ['identity'],
  reason: 'The top marking is worn; “P” and “PB” both fit what is legible.',
  asked_at: '2026-11-06T09:03:00.000Z',
  steps: [
    {
      id: 'variant',
      prompt: 'Which ATmega328P variant is this?',
      assumption: 'Working on ATmega328P-AU.',
      answer: {
        kind: 'choice',
        options: [
          { id: 'p', label: 'ATmega328P-AU', detail: 'matches slip line 3' },
          { id: 'pb', label: 'ATmega328PB-AU' },
        ],
        other: true,
      },
    },
  ],
})

const snapshot = (withSessions: boolean) =>
  ({
    batch_id: batchId,
    capture_revision: batch.revision,
    runner_status: withSessions ? 'native_unverified' : 'fixture_only',
    cursor: batch.cursor,
    jobs: [
      job(1, 'reading', 'ready', lot(1)),
      job(2, 'identifying', 'waiting_for_user', lot(2), {
        questions: [
          question(2, lot(2), 'Is the last letter of the marking a P?', 'Assuming ATmega328P'),
        ],
        ...(withSessions
          ? {
              session_state: 'waiting_input',
              latest_status: {
                text: 'Waiting for the marking answer',
                at: '2026-11-06T09:04:00.000Z',
              },
            }
          : {}),
      }),
      job(
        3,
        'research',
        'running',
        lot(3),
        withSessions
          ? {
              session_state: 'running',
              latest_status: {
                text: 'Checking the LM358 datasheet',
                at: '2026-11-06T09:06:00.000Z',
              },
            }
          : {},
      ),
      job(
        4,
        'images',
        'failed',
        lot(1),
        withSessions
          ? { session_state: 'failed', attempt_number: '3', start_fresh: { allowed: true } }
          : {},
      ),
      ...(withSessions
        ? [
            job(5, 'examine', 'running', null, {
              session_state: 'running',
              latest_status: {
                text: 'Checking whether packet A’s two photos show one bag',
                at: '2026-11-06T09:05:00.000Z',
              },
              questions: [steppedQuestion()].map((question) => ({
                ...question,
                ...answerSummary(question as unknown as ProcessingQuestionDto),
              })),
            }),
            job(6, 'research', 'running', lot(2), {
              session_state: 'running',
              latest_status: {
                text: 'Comparing the ATmega328P and PB datasheets',
                at: '2026-11-06T09:05:30.000Z',
              },
              questions: [choiceQuestion()],
            }),
          ]
        : []),
    ],
  }) as unknown as ProcessingSnapshotDto

const selection = {
  provider: 'claude',
  authentication: 'subscription',
  model: 'claude-opus-5-5',
} as const

const savedSettings: AgentSettingsDto = {
  revision: '2',
  providers: {
    claude: { enabled: true, authentication: 'subscription', default_model: selection.model },
    codex: { enabled: false, authentication: 'subscription', default_model: 'gpt-6.1-sol' },
  },
  default_provider: 'claude',
  stage_selections: {},
  session_concurrency: 3,
  new_batch_instructions: '',
  part_description_style: '',
  auto_tags_default: false,
  web: { public_pages: true, prefer_datasheets: true },
}

function session(n: number, stage: string, subject: string | null, extra: object) {
  return sessionRow({
    attempt_id: id(n + 20),
    batch_id: batchId,
    job_id: id(n),
    subject_id: subject,
    stage: stage as AgentSessionDto['stage'],
    state: 'running',
    selection,
    settings_revision: '2',
    queued_at: '2026-11-06T08:00:00.000Z',
    started_at: '2026-11-06T08:01:00.000Z',
    state_since: '2026-11-06T08:01:00.000Z',
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    ...extra,
  })
}

const failure: SessionFailureDto = {
  id: id(90),
  category: 'provider_network',
  summary: 'The provider connection or protocol failed.',
  details_available: true,
  attempt_id: id(24),
  lineage_id: id(4),
  turn: '2',
  timestamp: '2026-11-07T01:42:00.000Z',
  correlation_id: id(91),
  code: 'agent_turn_failed',
  stage: 'turn',
  provider: 'claude',
  model: 'claude-opus-5-5',
  cli_version: '2.1.319',
  provider_session_id: null,
  causes: [],
  recovery: 'Check provider availability and connection settings before explicitly retrying.',
  truncated: false,
  // The provider's own reason, as an oversized image would be refused.
  provider_error: { kind: 'invalid_request', result: 'error_during_execution', http_status: 400 },
}

const stepCounts = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }

/** What the batch header counts: both agent questions, the failed Images job and two Review decisions. */
const attention = {
  batch_id: batchId,
  revision: batch.revision,
  processing: {
    questions: 2,
    failed: 1,
    running: 2,
    steps: {
      examine: { ...stepCounts, questions: 1, jobs: 2, ready: 1, running: 1 },
      research: { ...stepCounts, questions: 1, jobs: 2, running: 2 },
      images: { ...stepCounts, failed: 1, jobs: 1 },
      inventory: stepCounts,
    },
  },
  review: { to_check: 3, changed_after_review: 0, needs_answer: 2, to_decide: 2, records: 4 },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [
    {
      key: 'question:stepped',
      group: 'question',
      tab: 'processing',
      title: 'About the 10 kΩ packets',
      detail: null,
      question: { steps: [{ kind: 'choice', options: 2, assumption: 'Assuming the same Part' }] },
      route: `${batchId}/processing/examine/${id(45)}`,
    },
    {
      key: 'question:choice',
      group: 'question',
      tab: 'processing',
      title: 'Which ATmega328P variant is this?',
      detail: null,
      question: { steps: [{ kind: 'choice', options: 2, assumption: 'Assuming the P variant' }] },
      route: `${batchId}/processing/research/${id(46)}`,
    },
    {
      key: 'failed:images',
      group: 'failed_job',
      tab: 'processing',
      title: 'Images failed for 10 kΩ resistor 0603 — packet A',
      detail: 'The provider connection failed.',
      route: `${batchId}/processing/images`,
    },
    {
      key: 'decision:location',
      group: 'decision',
      tab: 'review',
      title: 'Choose a location for the LM358 tube',
      detail: 'Two drawers match',
      route: `${batchId}/review/records`,
    },
    {
      key: 'decision:part',
      group: 'decision',
      tab: 'review',
      title: 'Reuse RES-0144 for packet A?',
      detail: null,
      route: `${batchId}/review/records`,
    },
  ],
  items_truncated: false,
} as unknown as BatchAttentionDto

/** Paused batches; Pause all and Resume change it, and the next list read shows it. */
const paused = new Set<string>()

const fixtureSessions = (supported: boolean) => {
  const rows = (
    supported
      ? [
          session(4, 'images', lot(1), {
            state: 'failed',
            session_state: 'failed',
            occupies_lane: false,
            progress: 'settled',
            finished_at: failure.timestamp,
            state_since: failure.timestamp,
            failure: {
              ...failure,
              failed_at: failure.timestamp,
              cause: {
                code: 'agent_turn_failed',
                provider: 'claude',
                provider_error: failure.provider_error,
              },
            },
            attempt_number: 3,
            start_fresh: { allowed: true },
            earlier_attempt_count: 2,
            earlier_attempts: [2, 1].map((number) => ({
              attempt_id: id(40 + number),
              number,
              state: 'superseded' as const,
              session_state: 'failed' as const,
              queued_at: '2026-11-06T07:00:00.000Z',
              ended_at: `2026-11-06T07:${number}5:00.000Z`,
              failure: {
                ...failure,
                id: id(92 + number),
                cause: {
                  code: 'agent_admission_unavailable' as const,
                  provider: 'claude' as const,
                },
              },
            })),
          }),
          session(3, 'research', lot(3), {
            latest_status: {
              text: 'Comparing two supplier listings',
              at: '2026-11-06T08:05:00.000Z',
            },
          }),
          session(2, 'examine', lot(2), {
            state: 'waiting_for_user',
            occupies_lane: false,
            session_state: 'waiting_input',
            latest_status: { text: 'Asked about the last letter', at: '2026-11-06T08:04:00.000Z' },
          }),
        ]
      : []
  ).map((item) => (paused.has(item.batch_id) ? { ...item, paused: true as const } : item))
  return sessionList({
    paused_batch_ids: [...paused],
    sessions: rows,
    counts: { needs_attention: 2, working: 1, waiting: 1, queued: 0, done_today: 0, all: 3 },
    totals: { slots_in_use: 1, queued: 0, waiting: 1 },
    batches: [
      {
        batch_id: batchId,
        archived: false,
        sessions: 3,
        matching: 3,
        first_started_at: '2026-11-06T08:01:00.000Z',
      },
    ],
    sessions_supported: supported,
  })
}

const pauseClient = {
  pause: async (batchId: string, pause: boolean) => {
    if (pause) {
      paused.add(batchId)
    } else {
      paused.delete(batchId)
    }
    return { batch_id: batchId, paused: pause }
  },
  pauseAll: async (pause: boolean) => {
    if (pause) {
      paused.add(batch.id)
    } else {
      paused.clear()
    }
    return { paused: pause, batch_ids: [batch.id] }
  },
}

export function ProcessingProof() {
  const view = useHashRoute('overview')
  const sessions = !view.endsWith('-fixture')
  // The app's own Processing links, such as a lot table pill, open their step here too.
  const linked = parseBatchRoute(view)
  const processingLink =
    linked.kind === 'route' && linked.batchId === batchId && linked.route.tab === 'processing'
      ? {
          step: linked.route.step,
          lot: lotFromQuery(linked.query),
          session: new URLSearchParams(linked.query).get('session'),
          sessionPage: 'sessionJobId' in linked.route ? linked.route.sessionJobId : undefined,
          questionId: 'questionId' in linked.route ? linked.route.questionId : undefined,
        }
      : null
  const page = processingLink?.step ?? view.replace('-fixture', '')
  const [answerOutcomes] = useState(createAnswerOutcomes)
  const delivery = useInstructionDelivery(batch.id, async () => ({ sessions: 2, woken: 1 }))
  const client = {
    read: async () => {
      await new Promise((settle) => setTimeout(settle, READ_DELAY_MS))
      return {
        ...snapshot(sessions),
        ...(paused.has(batch.id) ? { paused: true } : {}),
      }
    },
    failure: async () => failure,
    start: async () => {
      throw new Error('fixture commands are disabled')
    },
    cancel: async () => {
      throw new Error('fixture commands are disabled')
    },
    // Answers are accepted in memory, so the stepped form can be shown end to end.
    answer: async (_batch: string, questionId: string, input: ProcessingAnswerDto) => {
      answered.add(questionId)
      const answer = { input, at: new Date().toISOString() }
      given.set(questionId, answer)
      // The lead reads its inbox a little later; the next poll shows the tick.
      setTimeout(() => {
        given.set(questionId, { ...answer, readAt: new Date().toISOString() })
      }, READ_AFTER_MS)
      return {
        answer_id: id(95),
        question_id: questionId,
        attempt_id: id(25),
        capture_revision: batch.revision,
        command_id: id(96),
      }
    },
    history: fixtureHistory({ batchId, id, lot }, examineAnswerEntry),
    chat: async () => {
      throw new Error('fixture commands are disabled')
    },
  }

  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead breadcrumb={[{ label: 'Batches', href: '#' }]} />
      <RefreshSignal>
        <PageContent $width="content">
          <Main>
            {page.startsWith('agents-heyyy') ? (
              <AgentSessions
                client={{ sessions: heyyySessions, settings: async () => savedSettings }}
                batches={async (id) => ({
                  title: HEYYY_NAMES[id] ?? 'Batch',
                  subjects: new Map([[HEYYY_LOT, 'GE S2CN1 diodes']]),
                  liveLots: new Set([HEYYY_LOT]),
                })}
              />
            ) : page.startsWith('agents') ? (
              <AgentSessions
                key={view}
                client={{
                  sessions: async () => fixtureSessions(sessions),
                  failure: async () => failure,
                  settings: async () => savedSettings,
                  ...pauseClient,
                }}
                batches={async () => ({
                  title: batch.title,
                  subjects: new Map(batch.lots.map((item) => [item.id, item.label])),
                  liveLots: new Set(batch.lots.map((item) => item.id)),
                })}
              />
            ) : (
              <ApiClientsProvider
                value={{
                  agents: {
                    sessions: async () => fixtureSessions(sessions),
                    settings: async () => savedSettings,
                    pause: pauseClient.pause,
                  },
                }}
              >
                <ProcessingWorkspace
                  key={view}
                  batch={batch}
                  client={client as never}
                  view={page as never}
                  focusLotId={processingLink?.lot}
                  sessionPageJobId={processingLink?.sessionPage}
                  questionId={processingLink?.questionId}
                  sessionId={processingLink?.session ?? null}
                  answerOutcomes={answerOutcomes}
                  attention={sessions ? attention : undefined}
                  navigate={() => {}}
                  onDirtyChange={() => {}}
                  onSaved={async () => {}}
                  instructions={{
                    text: 'Keep the two resistor packets apart.',
                    instruct: async () => void delivery.deliver?.(),
                    delivery: delivery.delivery,
                    deliver: delivery.deliver,
                  }}
                />
              </ApiClientsProvider>
            )}
          </Main>
        </PageContent>
      </RefreshSignal>
    </ServerStateProvider>
  )
}
