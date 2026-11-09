import { useRef, useState } from 'react'
import styled from 'styled-components'
import type {
  CaptureObservationDto,
  CaptureSnapshotDto,
  CatalogueModelDto,
  CatalogueRecordDto,
} from '@invimport/contracts'
import type { SettingsPorts } from '#/capture/types'
import type { CatalogueClient } from '#/catalogue/types'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { GlobalStyle } from '#/components/GlobalStyle'
import { CaptureWorkspace } from '#/components/capture/CaptureWorkspace'

const scope = {
  origin: 'http://fixture.invalid',
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: 'b0000000-0000-4000-8000-00000000000b',
  targetContextId: '40000000-0000-4000-8000-000000000004',
}
const lotId = '60000000-0000-4000-8000-000000000006'
const initial: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  title: 'Synthetic bench receipts · separate packets',
  revision: '1',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  lots: [
    {
      id: lotId,
      label: 'Packet A · opened bag',
      revision: '1',
      contribution_key: '80000000-0000-4000-8000-000000000008',
      part_subject_id: null,
      quantity: { mode: 'set', value: '12' },
      location: { mode: 'clear' },
    },
  ],
  parts: [],
  observations: [],
  notes: [
    {
      id: '90000000-0000-4000-8000-000000000009',
      subject_id: null,
      text: 'Synthetic receipt: keep the opened packet distinct from the unopened packet.',
      actor_id: scope.actorId,
      producer: 'human',
      created_at: '2026-11-03T00:00:00Z',
    },
  ],
  cursor: { stream_id: 'a0000000-0000-4000-8000-00000000000a', sequence: '0' },
}

const location = (pk: string, name: string, path: string): CatalogueRecordDto => ({
  kind: 'location',
  pk,
  name,
  description: '',
  path,
  parent_pk: null,
  structural: false,
})

const supplier = (pk: string, name: string): CatalogueRecordDto => ({
  kind: 'supplier',
  pk,
  name,
  description: '',
  manufacturer: false,
})

const records: Record<CatalogueModelDto, CatalogueRecordDto[]> = {
  location: [
    location('41', 'Incoming inspection drawer', 'Bench/Incoming inspection drawer'),
    location('42', 'Incoming inspection drawer', 'Store/Incoming inspection drawer'),
    location('43', 'Resistor drawer', 'Store/Resistor drawer'),
  ],
  supplier: [supplier('7', 'Mouser Electronics'), supplier('8', 'Digi-Key')],
}

const coverage = (model: CatalogueModelDto) => ({
  loaded: records[model].length,
  total: records[model].length,
  truncated: false,
})

const catalogue: CatalogueClient = {
  candidates: async (_id, model) => ({
    model,
    target_context_id: scope.targetContextId,
    candidates: records[model],
    coverage: coverage(model),
  }),
  search: async (_id, model, q) => ({
    model,
    target_context_id: scope.targetContextId,
    query: q,
    results: [],
    coverage: coverage(model),
    exact_id: { status: 'not_requested' },
  }),
} as CatalogueClient

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Owned synthetic Capture: in-memory saves and catalogue, no network, inventory or provider. */
export function CaptureSettingsProof() {
  const [batch, setBatch] = useState(initial)
  const saved = useRef(initial)
  const [log, setLog] = useState<string[]>([])

  const observe = async (model: string, pk: string) => {
    const record = [...records.location, ...records.supplier].find((item) => item.pk === pk)
    const observation = {
      id: `c0000000-0000-4000-8000-${pk.padStart(12, '0')}`,
      model,
      pk,
      target_context_id: scope.targetContextId,
      label: record?.name ?? `Record ${pk}`,
      mapping: model === 'company' ? { kind: 'company', supplier: true } : { kind: 'location' },
    } as unknown as CaptureObservationDto
    setBatch((current) => ({
      ...current,
      observations: [
        ...current.observations.filter((item) => item.id !== observation.id),
        observation,
      ],
    }))
    return observation
  }

  const ports: SettingsPorts = {
    connected: true,
    async save(change, revision, key) {
      await delay(300)
      if (revision !== saved.current.revision) {
        throw new Error('fixture_revision_conflict')
      }
      saved.current = {
        ...saved.current,
        observations: batch.observations,
        title: change.title,
        revision: (BigInt(revision) + 1n).toString(),
      }
      setLog((items) => [
        ...items,
        `${saved.current.revision}: ${change.title} (${key.slice(0, 8)})`,
      ])
      return saved.current
    },
    accept: (snapshot) => setBatch(snapshot),
    read: async () => saved.current,
    catalogue,
  }

  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Main>
        <p>Owned synthetic Capture fixture · in-memory saves, no inventory or provider requests.</p>
        <CaptureWorkspace
          batch={batch}
          busy={false}
          observe={observe as never}
          edit={async () => true}
          settings={ports}
        />
        <ol aria-label="Acknowledged fixture saves">
          {log.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </Main>
    </ServerStateProvider>
  )
}

const Main = styled.main`
  padding: 16px;
  max-width: 1440px;
  margin: auto;
`
