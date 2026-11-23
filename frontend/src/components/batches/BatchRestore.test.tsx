import { act, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import type { Client } from '#/capture/client'
import type { ManualClient } from '#/manual/types'
import type { ProcessingClient } from '#/processing/types'
import { serverQueryKey } from '#/queries/scope'
import { snapshots } from '#/queries/snapshots'
import { fixtureScope, render } from '#/test/render'
import { Batch } from './Batch'

const batchId = '10000000-0000-4000-8000-000000000001'
const lotId = '20000000-0000-4000-8000-000000000002'
const cursor = { stream_id: 'b0000000-0000-4000-8000-000000000002', sequence: '8' }
const capture: CaptureSnapshotDto = {
  id: batchId,
  source_id: '90000000-0000-4000-8000-000000000009',
  title: 'Restored reels',
  revision: '8',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    {
      id: lotId,
      label: 'Reel A',
      revision: '3',
      contribution_key: 'a0000000-0000-4000-8000-000000000001',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  cursor,
}
const processing: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor,
  jobs: [
    {
      id: '30000000-0000-4000-8000-000000000003',
      subject_id: lotId,
      stage: 'research',
      revision: '1',
      state: 'running',
      attempt_id: '40000000-0000-4000-8000-000000000004',
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'fixture_only',
      proposals: [],
      questions: [],
    },
  ],
}

let cache: QueryClient | undefined

function Grab() {
  cache = useQueryClient()
  return null
}

function never<T>() {
  return new Promise<T>(() => undefined)
}

beforeEach(() => {
  sessionStorage.clear()
  snapshots.write('batch', fixtureScope, batchId, capture)
  snapshots.write('processing', fixtureScope, batchId, processing)
})

afterEach(() => sessionStorage.clear())

test('after a reload, the open tab shows its snapshot read-only until Capture’s read lands', async () => {
  let landCapture: ((value: CaptureSnapshotDto) => void) | undefined
  const client = {
    read: vi.fn(
      () =>
        new Promise<CaptureSnapshotDto>((resolve) => {
          landCapture = resolve
        }),
    ),
  } as unknown as Client
  const processingClient = {
    read: vi.fn(() => never<ProcessingSnapshotDto>()),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
  } as unknown as ProcessingClient
  render(
    <>
      <Grab />
      <Batch
        id={batchId}
        client={client}
        manual={{} as ManualClient}
        route={`${batchId}/processing/research`}
        onDirtyChange={vi.fn()}
      />
    </>,
    { clients: { processing: processingClient } },
  )

  // The header and the Research page come from the snapshots at once.
  expect(screen.getByRole('heading', { name: 'Restored reels' })).toBeInTheDocument()
  expect(screen.queryByText(/Resuming saved batch/)).not.toBeInTheDocument()
  const fence = document.querySelector('[data-display-only]')
  expect(fence).toHaveAttribute('inert')
  expect(fence).toHaveTextContent('Reel A')
  // Commands are inside the fence and unavailable; the snapshot never entered the query cache.
  expect(fence).toContainElement(
    screen.getByRole('button', { name: 'Queue new processing attempts', hidden: true }),
  )
  expect(cache!.getQueryData(serverQueryKey(fixtureScope, 'processing', batchId))).toBeUndefined()
  expect(cache!.getQueryData(serverQueryKey(fixtureScope, 'capture', batchId))).toBeUndefined()

  await act(async () => landCapture!(capture))
  await waitFor(() => expect(document.querySelector('[data-display-only]')).toBeNull())
  // The live workspace shows the restored Processing data until its own read lands, unverified.
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  expect(queue).toHaveAttribute('aria-disabled', 'true')
})

test('a snapshot from another target is never shown', async () => {
  sessionStorage.clear()
  snapshots.write(
    'batch',
    { ...fixtureScope, targetId: 'f0000000-0000-4000-8000-00000000000f' },
    batchId,
    capture,
  )
  const client = { read: vi.fn(() => never<CaptureSnapshotDto>()) } as unknown as Client
  render(
    <Batch
      id={batchId}
      client={client}
      manual={{} as ManualClient}
      route={`${batchId}/review/lots`}
      onDirtyChange={vi.fn()}
    />,
  )
  // A first visit instead: Review's skeleton until Capture's read lands.
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByText(/Resuming saved batch/)).not.toBeInTheDocument()
  expect(screen.queryByText('Restored reels')).not.toBeInTheDocument()
})
