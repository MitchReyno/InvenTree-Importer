import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { ServerStateProvider } from '../query/ServerStateProvider'
import { createServerQueryClient } from '../../queries/client'
import { serverQueryKey } from '../../queries/scope'
import { fixtureScope } from '../../test/render'
import type { MediaClient } from '../../media/types'
import { MediaWorkspace } from './MediaWorkspace'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Scoped retained media',
  revision: '1',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '30000000-0000-4000-8000-000000000003', sequence: '0' },
}
const snapshot: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  evidence: [],
  groups: [],
  attachments: [],
  derivations: [],
}

function client(read: MediaClient['snapshot']): MediaClient {
  return {
    snapshot: read,
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(async () => {
      throw new Error('lost acknowledgment')
    }),
  }
}

test('warm cache cannot authorize media input before this mount obtains a successful fresh read', async () => {
  const queries = createServerQueryClient()
  const key = serverQueryKey(fixtureScope, 'media', batch.id)
  queries.setQueryData(key, snapshot)

  let rejectRead: (reason: Error) => void = () => {
    throw new Error('read not started')
  }

  const media = client(
    vi.fn(
      () =>
        new Promise<MediaSnapshotDto>((_resolve, reject) => {
          rejectRead = reject
        }),
    ),
  )
  render(
    <ServerStateProvider scope={fixtureScope} client={queries}>
      <MediaWorkspace
        batch={batch}
        client={media}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  expect(screen.getByLabelText('Add a photo or PDF')).toBeDisabled()
  await act(async () => rejectRead(new Error('offline')))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Add a photo or PDF')).toBeDisabled()
  expect(media.upload).not.toHaveBeenCalled()
  expect(media.edit).not.toHaveBeenCalled()
  vi.mocked(media.snapshot).mockResolvedValue(snapshot)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() => expect(screen.getByLabelText('Add a photo or PDF')).toBeEnabled())
})

test('failed retained polling preserves pending original and its exact upload intent through recovery', async () => {
  const queries = createServerQueryClient()
  const key = serverQueryKey(fixtureScope, 'media', batch.id)
  const media = client(vi.fn(async () => snapshot))
  const user = userEvent.setup()
  render(
    <ServerStateProvider scope={fixtureScope} client={queries}>
      <MediaWorkspace
        batch={batch}
        client={media}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  const input = await screen.findByLabelText('Add a photo or PDF')
  await waitFor(() => expect(input).toBeEnabled())
  const file = new File(['source bytes'], 'retained.png', { type: 'image/png' })
  await user.upload(input, file)
  await user.click(screen.getByRole('button', { name: 'Retain retained.png' }))
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(1))
  const original = vi.mocked(media.upload).mock.calls[0]
  vi.mocked(media.snapshot).mockRejectedValue(new Error('offline'))
  await act(async () => {
    await queries.refetchQueries({ queryKey: key })
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retain retained.png' })).toBeDisabled(),
  )
  vi.mocked(media.snapshot).mockResolvedValue({ ...snapshot, revision: '8' })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retain retained.png' })).toBeEnabled(),
  )
  await user.click(screen.getByRole('button', { name: 'Retain retained.png' }))
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(2))
  expect(vi.mocked(media.upload).mock.calls[1]).toEqual(original)
  expect(original[1]).toBe('1')
  expect(original[3]).toBe(file)
})

test('attachment options distinguish colliding identities and match visible retained version labels', async () => {
  const lotId = '90000000-0000-4000-8000-000000000009'
  const populated: MediaSnapshotDto = {
    ...snapshot,
    evidence: ['11111111-1000-4000-8000-000000000001', '11111111-2000-4000-8000-000000000002'].map(
      (id, evidenceIndex) => ({
        id,
        label: 'photo.png',
        group_id: null,
        linked_subject_ids: [],
        versions: [1, 2].map((versionIndex) => ({
          id: `22222222-${evidenceIndex}${versionIndex}00-4000-8000-000000000001`,
          evidence_id: id,
          kind: 'derived' as const,
          digest: 'a'.repeat(64),
          byte_size: '123',
          media_type: 'image/png' as const,
          state: 'ready' as const,
          decoder_build: 'fixture/1',
          recipe: null,
          pages: [
            {
              page: 1,
              width: 48,
              height: 36,
              preview_id: `33333333-${evidenceIndex}${versionIndex}00-4000-8000-000000000001`,
            },
          ],
        })),
      }),
    ),
  }
  const populatedBatch: CaptureSnapshotDto = {
    ...batch,
    lots: [
      {
        id: lotId,
        label: 'Chosen lot',
        revision: '1',
        contribution_key: '80000000-0000-4000-8000-000000000008',
        part_subject_id: null,
        quantity: { mode: 'unknown' },
        location: { mode: 'clear' },
      },
    ],
  }
  render(
    <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
      <MediaWorkspace
        batch={populatedBatch}
        client={client(vi.fn(async () => populated))}
        disabled={false}
        selectedSubject={lotId}
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  const select = await screen.findByRole('combobox', { name: 'Attachment for Chosen lot' })
  await waitFor(() => expect(select).toBeEnabled())
  const options = Array.from(select.querySelectorAll('option')).filter(
    (option) => option.value !== 'unset' && option.value !== 'declined',
  )
  expect(options).toHaveLength(4)
  expect(new Set(options.map((option) => option.textContent)).size).toBe(4)
  expect(options.map((option) => option.value)).toEqual(
    populated.evidence.flatMap((evidence) => evidence.versions.map((version) => version.id)),
  )
  for (const option of options) {
    const visibleVersion = screen.getAllByText(
      (text, element) =>
        element?.tagName === 'SMALL' && text.startsWith(`${option.textContent} · ready`),
    )
    expect(visibleVersion).toHaveLength(1)
    expect(option.textContent).toContain('photo.png · evidence 11111111')
    expect(option.textContent).toContain(' · crop 22222222')
  }
})
