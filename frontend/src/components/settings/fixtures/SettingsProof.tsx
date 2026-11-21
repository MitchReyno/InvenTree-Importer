import { useState } from 'react'
import styled from 'styled-components'
import type {
  AgentSettingsDto,
  AgentSettingsUpdateDto,
  BatchDefaultsDto,
  BatchDefaultsUpdateDto,
  CatalogueModelDto,
  CatalogueRecordDto,
  ConnectionStatusDto,
} from '@invimport/contracts'
import type { BatchDefaultsClient, CatalogueClient } from '#/catalogue/types'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { GlobalStyle } from '#/components/GlobalStyle'
import { ApiClientsProvider, HeaderObservationsProvider } from '#/context'
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
  web: { public_pages: true, prefer_datasheets: true },
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

// Staged for the demo: once checked, InvenTree has refused the token, and later reads say so,
// until a replacement is saved. The fixture refuses a replacement spelled `refused-token`.
let tokenRefused = false
let savedAt: string | null = null

const header: HeaderClient = {
  checkConnection: async () => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    tokenRefused = savedAt === null
    return header.connection()
  },
  replaceInventoryCredential: async ({ token }) => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    if (token === 'refused-token') {
      throw new IntakeRequestError(422, 'token_refused')
    }
    tokenRefused = false
    savedAt = new Date().toISOString()
    return { credential_source: 'saved', credential_saved_at: savedAt }
  },
  revertInventoryCredential: async () => {
    savedAt = null
    return { credential_source: 'environment', credential_saved_at: null }
  },
  connection: async (): Promise<ConnectionStatusDto> =>
    ({
      ...identity,
      target: {
        kind: 'owned_test',
        state: tokenRefused ? 'unavailable' : 'reachable',
        freshness: 'fresh',
        observed_at: new Date().toISOString(),
        failure_code: tokenRefused ? 'unauthorized' : null,
        navigation_url: 'https://inventory.example.test/',
        label: 'Bench test InvenTree',
        version: tokenRefused ? null : '1.1.0',
        credential_source: savedAt ? 'saved' : 'environment',
        credential_saved_at: savedAt,
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
const locations: CatalogueRecordDto[] = [
  {
    kind: 'location',
    pk: '11',
    name: 'Incoming',
    description: 'Parts waiting for check-in',
    path: 'Bench/Incoming',
    parent_pk: null,
    structural: false,
  },
  {
    kind: 'location',
    pk: '12',
    name: 'Drawer 4',
    description: 'Resistors',
    path: 'Bench/Drawer 4',
    parent_pk: null,
    structural: false,
  },
]
const suppliers: CatalogueRecordDto[] = [
  { kind: 'supplier', pk: '7', name: 'Mouser Electronics', description: '', manufacturer: false },
  { kind: 'supplier', pk: '8', name: 'DigiKey', description: '', manufacturer: false },
]
const records = { location: locations, supplier: suppliers }

/** In-memory catalogue for the Settings pickers. */
const catalogue = {
  candidatesAll: async (model: CatalogueModelDto) => ({
    model,
    target_context_id: scope.targetContextId,
    candidates: records[model],
    coverage: { loaded: records[model].length, total: records[model].length, truncated: false },
  }),
  searchAll: async (model: CatalogueModelDto, query: string) => ({
    model,
    target_context_id: scope.targetContextId,
    query,
    results: records[model].filter((record) =>
      record.name.toLowerCase().includes(query.toLowerCase()),
    ),
    coverage: { loaded: 0, total: 0, truncated: false },
    exact_id: { status: 'not_requested' as const },
  }),
} as unknown as CatalogueClient

// The saved supplier was deleted in InvenTree, so Settings says so.
let savedDefaults: BatchDefaultsDto = {
  revision: '2',
  location: { pk: '11', label: 'Incoming', status: 'found' },
  supplier: { pk: '9', label: null, status: 'not_found' },
}

const batchDefaults = {
  read: async () => savedDefaults,
  save: async ({ expected_revision, location_pk, supplier_pk }: BatchDefaultsUpdateDto) => {
    const named = (list: CatalogueRecordDto[], pk: string | null) => {
      const record = list.find((item) => item.pk === pk)
      if (!pk) {
        return null
      }
      // A saved record InvenTree no longer has stays saved, reported as not found.
      return record
        ? { pk, label: record.name, status: 'found' as const }
        : { pk, label: null, status: 'not_found' as const }
    }

    savedDefaults = {
      revision: String(Number(expected_revision) + 1),
      location: named(locations, location_pk),
      supplier: named(suppliers, supplier_pk),
    }
    return savedDefaults
  },
} as unknown as BatchDefaultsClient

export function SettingsProof() {
  const [cache] = useState(batchReads)
  const route = useHashRoute('settings')

  return (
    <ServerStateProvider scope={scope} client={cache}>
      <GlobalStyle />
      <HeaderObservationsProvider client={header}>
        <ApiClientsProvider value={{ catalogue, batchDefaults }}>
          <Page>
            <Settings
              section={settingsSection(route)}
              subsection={settingsSubsection(route)}
              returnTo={`${batchId}/processing/overview`}
              agents={agents}
              onDirtyChange={() => {}}
            />
          </Page>
        </ApiClientsProvider>
      </HeaderObservationsProvider>
    </ServerStateProvider>
  )
}

const Page = styled.main`
  max-width: 1100px;
  margin: 0 auto;
  padding: ${space[12]} ${space[8]};
`
