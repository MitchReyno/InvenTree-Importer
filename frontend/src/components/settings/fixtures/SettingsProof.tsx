import { useState } from 'react'
import styled from 'styled-components'
import type {
  AgentSettingsDto,
  AgentSettingsUpdateDto,
  ConnectionStatusDto,
} from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { GlobalStyle } from '#/components/GlobalStyle'
import { HeaderObservationsProvider } from '#/context'
import { settingsSection, settingsSubsection } from '#/navigation/app-route'
import { useHashRoute } from '#/navigation/useHashRoute'
import { space } from '#/theme/generated/tokens'
import type { HeaderClient } from '#/header/types'
import { Settings } from '../Settings'

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

let saved: AgentSettingsDto = {
  revision: '7',
  providers: {
    claude: { enabled: true, authentication: 'subscription', default_model: 'opus' },
    codex: { enabled: false, authentication: 'subscription', default_model: 'gpt-6.1-sol' },
  },
  default_provider: 'claude',
  stage_selections: {},
  session_concurrency: 3,
  new_batch_instructions: '',
  part_description_style: '',
  auto_tags_default: false,
}

function session(index: number, running: boolean) {
  return {
    attempt_id: `20000000-0000-4000-8000-00000000000${index}`,
    job_id: `21000000-0000-4000-8000-00000000000${index}`,
    batch_id: batchId,
    subject_id: null,
    stage: 'research',
    state: running ? 'running' : 'queued',
    occupies_lane: running,
    latest_on_job: true,
    queued_at: '2026-11-10T01:00:00.000Z',
    started_at: null,
    finished_at: null,
    session_state: null,
    latest_status: null,
  }
}

/**
 * An in-memory agents client. The credential panels still POST to `/personal-runner/*`, which this
 * fixture's server doesn't answer, so their checks fail.
 */
const agents = {
  settings: async () => saved,
  saveSettings: async ({ expected_revision, ...fields }: AgentSettingsUpdateDto) => {
    saved = { ...fields, revision: String(Number(expected_revision) + 1) }
    return saved
  },
  sessions: async () => ({
    sessions: [session(1, true), session(2, true), session(3, true), session(4, false)],
    next_before: null,
    sessions_supported: true,
  }),
  failure: async () => {
    throw new Error('owned_fixture_no_failure')
  },
  pause: async () => ({}),
  pauseAll: async (paused: boolean) => ({ paused, batch_ids: [] }),
  deliverInstructions: async () => ({ sessions: 0 }),
} as unknown as ReturnType<typeof agentsClient>

const header: HeaderClient = {
  // Staged for the demo: a check takes a moment, then InvenTree refuses the token.
  checkConnection: async () => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    const current = await header.connection()
    return {
      ...current,
      target: {
        ...current.target,
        state: 'unavailable',
        failure_code: 'unauthorized',
        version: null,
      },
    }
  },
  connection: async (): Promise<ConnectionStatusDto> =>
    ({
      ...identity,
      target: {
        kind: 'owned_test',
        state: 'reachable',
        freshness: 'fresh',
        observed_at: new Date().toISOString(),
        failure_code: null,
        navigation_url: 'https://inventory.example.test/',
        label: 'Bench test InvenTree',
        version: '1.1.0',
      },
    }) as ConnectionStatusDto,
  work: async () => ({
    ...identity,
    observed_at: new Date().toISOString(),
    work: [],
    active_sessions: [],
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: false,
  }),
}

/** The batch screen's read, which names the batch on the back link. */
function batchReads() {
  const cache = createServerQueryClient()
  cache.setQueryData(serverQueryKey(scope, 'capture', batchId), {
    id: batchId,
    title: 'Mouser 3381-22',
    revision: '4',
  })
  return cache
}

/** Settings opened from a batch's Processing tab; the hash picks the section. */
export function SettingsProof() {
  const [cache] = useState(batchReads)
  const route = useHashRoute('settings')

  return (
    <ServerStateProvider scope={scope} client={cache}>
      <GlobalStyle />
      <HeaderObservationsProvider client={header}>
        <Page>
          <Settings
            section={settingsSection(route)}
            subsection={settingsSubsection(route)}
            returnTo={`${batchId}/processing/overview`}
            agents={agents}
            onDirtyChange={() => {}}
          />
        </Page>
      </HeaderObservationsProvider>
    </ServerStateProvider>
  )
}

const Page = styled.main`
  max-width: 1100px;
  margin: 0 auto;
  padding: ${space[12]} ${space[8]};
`
