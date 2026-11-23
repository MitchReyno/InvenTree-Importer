import type {
  AgentSettingsDto,
  SessionFailureDto,
  AgentSessionListDto,
  CaptureSnapshotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { AgentSessions } from '#/components/agents/AgentSessions'
import { ProcessingWorkspace } from '#/components/processing/ProcessingWorkspace'
import { Main, PageContent } from '#/components/AppLayout'
import { useInstructionDelivery } from '#/processing/instruction-delivery'
import { useHashRoute } from '#/navigation/useHashRoute'
import { ApiClientsProvider } from '#/context'

/** Owned browser fixture: synthetic clients only, no API, provider or InvenTree traffic. */
const scope = {
  origin: location.origin,
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: 'b0000000-0000-4000-8000-00000000000b',
  targetContextId: '40000000-0000-4000-8000-000000000004',
}
const batchId = '10000000-0000-4000-8000-000000000001'

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

const askedState = (questionId: string) => (answered.has(questionId) ? 'answered' : 'open')

/** The lead session's three related steps about two resistor packets. */
const steppedQuestion = () => ({
  id: id(45),
  job_id: id(5),
  attempt_id: id(25),
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: askedState(id(45)),
  subject_id: lot(1),
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
      job(4, 'images', 'failed', lot(1), withSessions ? { session_state: 'failed' } : {}),
      ...(withSessions
        ? [
            job(5, 'examine', 'running', null, {
              session_state: 'running',
              latest_status: {
                text: 'Checking whether packet A’s two photos show one bag',
                at: '2026-11-06T09:05:00.000Z',
              },
              questions: [steppedQuestion()],
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
  return {
    attempt_id: id(n + 20),
    batch_id: batchId,
    job_id: id(n),
    subject_id: subject,
    stage,
    state: 'running',
    latest_on_job: true,
    selection,
    settings_revision: '2',
    queued_at: '2026-11-06T08:00:00.000Z',
    started_at: '2026-11-06T08:01:00.000Z',
    finished_at: null,
    native_session_id: null,
    actual_model: null,
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    latest_status: null,
    ...extra,
  }
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

/** Paused batches; Pause all and Resume change it, and the next list read shows it. */
const paused = new Set<string>()

const sessionList = (supported: boolean) =>
  ({
    paused_batch_ids: [...paused],
    sessions: (supported
      ? [
          session(4, 'images', lot(1), {
            state: 'failed',
            session_state: 'failed',
            occupies_lane: false,
            progress: 'settled',
            finished_at: failure.timestamp,
            failure,
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
    ).map((item) => (paused.has(item.batch_id) ? { ...item, paused: true } : item)),
    next_before: null,
    sessions_supported: supported,
  }) as unknown as AgentSessionListDto

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
  const page = view.replace('-fixture', '')
  const delivery = useInstructionDelivery(batch.id, async () => ({ sessions: 2, woken: 1 }))
  const client = {
    read: async () => ({
      ...snapshot(sessions),
      ...(paused.has(batch.id) ? { paused: true } : {}),
    }),
    failure: async () => failure,
    start: async () => {
      throw new Error('fixture commands are disabled')
    },
    cancel: async () => {
      throw new Error('fixture commands are disabled')
    },
    // Answers are accepted in memory, so the stepped form can be shown end to end.
    answer: async (_batch: string, questionId: string) => {
      answered.add(questionId)
      return {
        answer_id: id(95),
        question_id: questionId,
        attempt_id: id(25),
        capture_revision: batch.revision,
        command_id: id(96),
      }
    },
    session: async (_batch: string, jobId: string) => ({
      job_id: jobId,
      attempt_id: jobId === id(4) ? id(24) : id(42),
      session_state: jobId === id(4) ? 'failed' : 'waiting_input',
      ...(jobId === id(4) ? { failure } : {}),
      truncated: false,
      outbox: [],
      inbox: [],
    }),
    chat: async () => {
      throw new Error('fixture commands are disabled')
    },
  }

  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead breadcrumb={[{ label: 'Batches', href: '#' }]} />
      <PageContent $width="content">
        <Main>
          {page.startsWith('agents') ? (
            <AgentSessions
              key={view}
              client={{
                sessions: async () => sessionList(sessions),
                failure: async () => failure,
                settings: async () => savedSettings,
                ...pauseClient,
              }}
              batches={async () => ({
                title: batch.title,
                subjects: new Map(batch.lots.map((item) => [item.id, item.label])),
              })}
            />
          ) : (
            <ApiClientsProvider
              value={{
                agents: {
                  sessions: async () => sessionList(sessions),
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
    </ServerStateProvider>
  )
}
