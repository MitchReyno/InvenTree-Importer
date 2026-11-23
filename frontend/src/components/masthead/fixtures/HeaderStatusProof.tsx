import { useRef, useState } from 'react'
import styled from 'styled-components'
import type { BatchAttentionDto, ConnectionStatusDto, HeaderWorkDto } from '@invimport/contracts'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { GlobalStyle } from '#/components/GlobalStyle'
import { HeaderStatus } from '#/components/masthead/HeaderStatus'
import { Masthead } from '#/components/masthead/Masthead'
import type { HeaderClient } from '#/header/types'
import { ApiClientsProvider, UpdateHealthContext } from '#/context'

const scope = {
  origin: 'http://localhost:3000',
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: '40000000-0000-4000-8000-000000000004',
  targetContextId: '50000000-0000-4000-8000-000000000005',
}
const identity = {
  actor_id: scope.actorId,
  target_id: scope.targetId,
  target_context_id: scope.targetContextId,
}
const batchId = '10000000-0000-4000-8000-000000000001'
const attempt = '20000000-0000-4000-8000-000000000002'
const noWork = {
  questions: 0,
  failed: 0,
  jobs: 0,
  ready: 0,
  running: 0,
  waiting: 0,
  queued: 0,
  ready_lots: 0,
}
const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '4',
  processing: {
    questions: 3,
    failed: 0,
    running: 2,
    lots: 0,
    paused: false,
    steps: {
      examine: { ...noWork, jobs: 12, ready: 12 },
      research: { ...noWork, questions: 3, jobs: 12, ready: 7, running: 2 },
      images: noWork,
      inventory: noWork,
    },
  },
  review: { to_check: 0, changed_after_review: 0, needs_answer: 0, to_decide: 0, records: 0 },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [],
  items_truncated: false,
}

/** The batch screen's reads, which the header shares for the batch name and question count. */
function batchReads() {
  const cache = createServerQueryClient()
  cache.setQueryData(serverQueryKey(scope, 'capture', batchId), {
    id: batchId,
    title: 'Mouser 3381-22 + bench bag',
    revision: '4',
  })
  cache.setQueryData(serverQueryKey(scope, 'attention', batchId, '4'), attention)
  return cache
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

/**
 * A batch part-way through: Examine formed its lots and waits on two questions, Research's turn runs,
 * Images has 9 of 12 lots and Inventory waits on both. Pausing it hatches the unfinished stages.
 */
function stagesWork(paused: boolean): HeaderWorkDto {
  const id = (n: number) => `2000000${n}-0000-4000-8000-00000000000${n}`

  const session = (n: number, stage: 'examine' | 'research', text: string, minutes: number) => ({
    attempt_id: id(n),
    batch_id: batchId,
    job_id: id(n),
    stage,
    state: stage === 'examine' ? ('waiting_for_user' as const) : ('running' as const),
    selection: {
      provider: 'claude' as const,
      authentication: 'subscription' as const,
      model: 'sonnet',
    },
    actual_model: 'claude-sonnet-5-5',
    progress: 'responding' as const,
    occupies_lane: stage !== 'examine',
    session_state: stage === 'examine' ? ('waiting_input' as const) : ('running' as const),
    latest_status: { text, at: minutesAgo(minutes) },
    current: true,
  })

  const job = (n: number, stage: string, state: HeaderWorkDto['work'][number]['state']) =>
    ({
      kind: 'processing' as const,
      id: id(n),
      batch_id: batchId,
      attempt_id: id(n),
      stage,
      state,
      input_current: true,
      occupies_lane: state === 'running',
      blocked_code: null,
      steps: [{ stage, state }],
      steps_complete: false,
    }) as HeaderWorkDto['work'][number]

  return {
    ...identity,
    observed_at: new Date().toISOString(),
    work: [job(1, 'examine', 'waiting_for_user'), job(2, 'research', 'running')],
    active_sessions: [
      session(1, 'examine', 'Asked whether both invoices are one order', 4),
      session(2, 'research', 'Comparing the reel label with the TI datasheet', 1),
    ],
    batch_steps: [
      {
        batch_id: batchId,
        paused,
        lots: 12,
        steps: {
          examine: { ...noWork, jobs: 1, ready: 1, questions: 2 },
          research: { ...noWork, jobs: 12, ready: 7, running: 1, ready_lots: 7 },
          images: { ...noWork, jobs: 12, ready: 9, ready_lots: 9 },
          inventory: noWork,
        },
      },
    ],
    paused_batches: paused ? [{ batch_id: batchId, title: 'Mouser 3381-22 + bench bag' }] : [],
    paused_truncated: false,
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: true,
  }
}

type Scenario =
  | 'connected'
  | 'unavailable'
  | 'stale'
  | 'idle'
  | 'partial'
  | 'cancelled'
  | 'offline'
  | 'unconfigured'
  | 'transport-stale'
  | 'stages'

export function HeaderStatusProof() {
  const [cache] = useState(batchReads)
  const paused = useRef(true)
  const scenario = useRef<Scenario>('cancelled')
  const [selected, setSelected] = useState<Scenario>('cancelled')
  const [tab, setTab] = useState('Capture')
  const client: HeaderClient = {
    checkConnection: () => client.connection(),
    replaceInventoryCredential: async () => ({
      credential_source: 'saved',
      credential_saved_at: new Date().toISOString(),
    }),
    revertInventoryCredential: async () => ({
      credential_source: 'environment',
      credential_saved_at: null,
    }),
    connection: async () => {
      if (scenario.current === 'offline') {
        throw new Error('owned_fixture_offline')
      }
      const target: ConnectionStatusDto['target'] = {
        state:
          scenario.current === 'unconfigured'
            ? 'unconfigured'
            : scenario.current === 'unavailable'
              ? 'unavailable'
              : 'reachable',
        freshness: scenario.current === 'stale' ? 'stale' : 'fresh',
        observed_at: new Date(
          Date.now() - (scenario.current === 'stale' ? 61_000 : 0),
        ).toISOString(),
        failure_code: scenario.current === 'unavailable' ? 'timeout' : null,
        navigation_url:
          scenario.current === 'unconfigured' ? null : 'https://inventory.example.test/',
        label: 'Synthetic bench target',
        version: ['unconfigured', 'unavailable'].includes(scenario.current) ? null : '0.17.10',
      }
      return { ...identity, target }
    },
    work: async () => {
      if (scenario.current === 'offline') {
        throw new Error('owned_fixture_offline')
      }
      if (scenario.current === 'stages') {
        const staged = stagesWork(paused.current)
        // The open batch's own attention read gives its counts, as on the batch screen.
        const counted = staged.batch_steps![0]
        cache.setQueryData<BatchAttentionDto>(serverQueryKey(scope, 'attention', batchId, '4'), {
          ...attention,
          processing: {
            questions: 2,
            failed: 0,
            running: 1,
            lots: counted.lots,
            paused: counted.paused,
            steps: counted.steps,
          },
        })
        return staged
      }
      const value: HeaderWorkDto = {
        ...identity,
        observed_at: new Date(
          Date.now() - (scenario.current === 'stale' ? 61_000 : 0),
        ).toISOString(),
        work: [],
        active_sessions: [],
        paused_batches: [],
        paused_truncated: false,
        work_truncated: scenario.current === 'partial',
        sessions_truncated: scenario.current === 'partial',
        lane_occupied: false,
      }
      if (scenario.current !== 'idle' && scenario.current !== 'unconfigured') {
        // The server's shape: one retained job per Processing step, each carrying that step.
        for (const [index, stage, state] of [
          [1, 'examine', 'ready'],
          [2, 'research', 'running'],
          [3, 'images', 'queued'],
          [4, 'inventory', 'queued'],
        ] as const) {
          const jobId = index === 2 ? attempt : `2000000${index}-0000-4000-8000-00000000000${index}`
          value.work.push({
            kind: 'processing',
            id: jobId,
            batch_id: batchId,
            attempt_id: jobId,
            stage,
            state,
            input_current: true,
            occupies_lane: stage === 'research',
            blocked_code: null,
            steps: [{ stage, state }],
            steps_complete: false,
          })
        }
        value.work.push({
          kind: 'import',
          id: scope.targetId,
          batch_id: scope.targetContextId,
          stage: 'inventory',
          state: 'queued',
          steps: [
            { name: 'approval', state: 'confirmed' },
            { name: 'dispatch', state: 'not_requested' },
            { name: 'inventory', state: 'none' },
          ],
          steps_complete: false,
        })
        value.active_sessions.push({
          attempt_id: attempt,
          batch_id: batchId,
          job_id: attempt,
          stage: 'research',
          state: scenario.current === 'cancelled' ? 'cancelled' : 'running',
          selection: {
            provider: 'codex',
            authentication: 'subscription',
            model: 'synthetic-model',
          },
          actual_model: null,
          progress: 'responding',
          occupies_lane: true,
          session_state: null,
          latest_status: null,
          current: true,
        })
        value.lane_occupied = true
      }
      return value
    },
  }
  return (
    <ServerStateProvider scope={scope} client={cache}>
      <ApiClientsProvider
        value={{
          agents: {
            sessions: async () => {
              throw new Error('owned_fixture_has_no_sessions')
            },
            settings: async () => {
              throw new Error('owned_fixture_has_no_settings')
            },
            pause: async (_batch: string, pause: boolean) => {
              paused.current = pause
              return { batch_id: batchId, paused: pause }
            },
          },
        }}
      >
        <GlobalStyle />
        {/* Full width above the page, as in the app. */}
        <Masthead
          breadcrumb={[{ label: 'Batches', href: '#' }]}
          status={
            <UpdateHealthContext.Provider
              value={{
                state: 'live',
                observedAt: Date.now() - (selected === 'transport-stale' ? 61_000 : 0),
                truncated: false,
              }}
            >
              <HeaderStatus client={client} batchId={batchId} />
            </UpdateHealthContext.Provider>
          }
        />
        <Main>
          <p>
            Owned synthetic header fixture · simulated transport and retained client · no API,
            inventory or provider traffic. The external target link is inspection-only and must not
            be opened during qualification.
          </p>
          <nav aria-label="Qualification scenario">
            {(
              [
                'connected',
                'unavailable',
                'stale',
                'idle',
                'partial',
                'cancelled',
                'offline',
                'unconfigured',
                'transport-stale',
                'stages',
              ] satisfies Scenario[]
            ).map((state) => (
              <button
                key={state}
                aria-pressed={selected === state}
                onClick={() => {
                  scenario.current = state
                  setSelected(state)
                  void cache.invalidateQueries({ queryKey: serverQueryKey(scope) })
                }}
              >
                Show {state} state
              </button>
            ))}
          </nav>
          <nav aria-label="Fixture tabs">
            {['Capture', 'Processing', 'Review'].map((name) => (
              <button key={name} onClick={() => setTab(name)}>
                {name}
              </button>
            ))}
          </nav>
          <h1>{tab}</h1>
          <label>
            Uncommitted human draft
            <textarea aria-label="Uncommitted human draft" />
          </label>
        </Main>
      </ApiClientsProvider>
    </ServerStateProvider>
  )
}

const Main = styled.main`
  max-width: 1600px;
  padding: 16px;
  margin: auto;
  label {
    display: grid;
    gap: 8px;
    margin-top: 16px;
  }
  select,
  textarea {
    max-width: 100%;
    min-height: 44px;
  }
  & > nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  nav button {
    min-height: 44px;
  }
`
