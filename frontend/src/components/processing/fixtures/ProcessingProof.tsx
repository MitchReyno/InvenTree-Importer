import { useEffect, useState } from 'react'
import type {
  SessionFailureDto,
  AgentSessionListDto,
  BatchAttentionDto,
  CaptureSnapshotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { GlobalStyle } from '../../GlobalStyle'
import { Masthead } from '../../masthead/Masthead'
import { ServerStateProvider } from '../../query/ServerStateProvider'
import { AgentSessions } from '../../agents/AgentSessions'
import { ProcessingWorkspace } from '../ProcessingWorkspace'
import { Main, PageContent } from '../../AppLayout'

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
  spec: { kind: 'clarification', subject_id: subject, prompt, reason: 'The marking is worn.' },
  ...(assumption ? { assumption } : {}),
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
    ],
  }) as unknown as ProcessingSnapshotDto

const attention = {
  batch_id: batchId,
  revision: '7',
  processing: {
    questions: 1,
    failed: 1,
    steps: {
      examine: { questions: 1, failed: 0 },
      research: { questions: 0, failed: 0 },
      images: { questions: 0, failed: 1 },
      inventory: { questions: 0, failed: 0 },
    },
  },
  review: { to_check: 2, changed_after_review: 0, to_decide: 1 },
  changes: { ready: 1, failed: 0, uncertain: 0 },
  items: [],
  items_truncated: false,
} as BatchAttentionDto

const selection = {
  provider: 'claude',
  authentication: 'subscription',
  model: 'claude-opus-5-5',
} as const

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
  id: id(90), category: 'tool_policy', summary: 'The provider attempted an operation outside the allowed tool policy.', details_available: true,
  attempt_id: id(24), lineage_id: id(4), turn: '2', timestamp: '2026-11-07T01:42:00.000Z', correlation_id: id(91),
  code: 'agent_tool_refused', stage: 'turn', provider: 'claude', model: 'claude-opus-5-5', cli_version: '2.1.319',
  provider_session_id: null, causes: [], recovery: 'Check the supported CLI configuration. Keep this conversation stopped and start a fresh session after correcting it.', truncated: false,
}

const sessionList = (supported: boolean) =>
  ({
    sessions: supported
      ? [
          session(4, 'images', lot(1), { state: 'failed', session_state: 'failed', occupies_lane: false, progress: 'settled', finished_at: failure.timestamp, failure }),
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
      : [],
    next_before: null,
    sessions_supported: supported,
  }) as unknown as AgentSessionListDto

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const follow = () => setHash(location.hash.slice(1))

    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [])
  return hash
}

export function ProcessingProof() {
  const view = useHash() || 'overview'
  const sessions = !view.endsWith('-fixture')
  const page = view.replace('-fixture', '')
  const client = {
    read: async () => snapshot(sessions),
    failure: async () => failure,
    start: async () => {
      throw new Error('fixture commands are disabled')
    },
    cancel: async () => {
      throw new Error('fixture commands are disabled')
    },
    answer: async () => {
      throw new Error('fixture commands are disabled')
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
<Masthead breadcrumb={[{ label: 'Batches', href: '#' }, { label: batch.title }]} />
      <PageContent $width="content">
<Main>
        {page.startsWith('agents') ? (
          <AgentSessions
            key={view}
            client={{
              sessions: async () => sessionList(sessions),
              failure: async () => failure,
              settings: async () => ({ revision: '2', selection, session_concurrency: 3 }),
            }}
            batches={async () => ({
              title: batch.title,
              subjects: new Map(batch.lots.map((item) => [item.id, item.label])),
            })}
          />
        ) : (
          <ProcessingWorkspace
            key={view}
            batch={batch}
            client={client as never}
            view={page as never}
            navigate={() => {}}
            onDirtyChange={() => {}}
            onSaved={async () => {}}
            attention={attention}
            instructions={{
              text: 'Keep the two resistor packets apart.',
              instruct: async () => {},
            }}
          />
        )}
      </Main>
</PageContent>
    </ServerStateProvider>
  )
}
