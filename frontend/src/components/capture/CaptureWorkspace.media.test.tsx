import { operatorReviewClient } from '@invimport/contracts/client'
import { createServerQueryClient } from '../../queries/client'
import { serverQueryKey } from '../../queries/scope'
import { ServerStateProvider } from '../query/ServerStateProvider'
import { render, fixtureScope } from '../../test/render'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import { CaptureWorkspace } from './CaptureWorkspace'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000003',
  target_context_id: '40000000-0000-4000-8000-000000000004',
  title: 'Media draft boundary',
  revision: '1',
  updated_at: '2026-11-02T00:00:00Z',
  archived: false,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '50000000-0000-4000-8000-000000000005', sequence: '0' },
}
const snapshot: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '0',
  evidence: [],
  attachments: [],
  groups: [],
  derivations: [],
}

function mediaClient(): MediaClient {
  return {
    snapshot: vi.fn(async () => snapshot),
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(async () => {
      throw new Error('not submitted')
    }),
  }
}

afterEach(() => {
  history.replaceState(null, '', location.pathname)
})

test('pending original cannot enable Capture save or lose its request when Capture rerenders', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  const media = mediaClient()
  const dirty = vi.fn()
  const props = {
    batch,
    busy: false,
    media,
    edit,
    observe: vi.fn(async () => null),
    onDirtyChange: dirty,
  }
  const view = render(<CaptureWorkspace {...props} />)
  const input = await screen.findByLabelText('Choose photos')
  const file = new File(['original bytes'], 'bench-photo.png', { type: 'image/png' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, file)

  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByRole('button', { name: 'Save Batch settings' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Archive batch' })).toBeDisabled()
  view.rerender(
    <CaptureWorkspace {...props} batch={{ ...batch, updated_at: '2026-11-02T00:01:00Z' }} />,
  )
  await user.click(screen.getByRole('button', { name: 'Save Batch settings' }))
  expect(edit).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Retain bench-photo.png' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'Retain bench-photo.png' }))
  await screen.findByRole('alert')
  const firstRequest = vi.mocked(media.upload).mock.calls[0]
  await user.click(screen.getByRole('button', { name: 'Retain bench-photo.png' }))
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(2))
  expect(vi.mocked(media.upload).mock.calls[1]).toEqual(firstRequest)
  expect(firstRequest[3]).toBe(file)

  await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(screen.getByRole('button', { name: 'Save Batch settings' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Archive batch' })).toBeEnabled()
})

test('Capture input freezes file selection until its own input is resolved', async () => {
  location.hash = `${batch.id}/batch`
  const user = userEvent.setup()
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      media={mediaClient()}
      edit={vi.fn(async () => undefined)}
      observe={vi.fn(async () => null)}
    />,
  )
  const upload = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(upload).toBeEnabled())
  await user.type(screen.getByRole('textbox', { name: 'Batch title' }), ' updated')
  expect(upload).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save Batch settings' })).toBeEnabled()
})

test('batch instructions cannot replace the active media query during a live invalidation', async () => {
  const cache = createServerQueryClient()
  const media = mediaClient()
  const operator = operatorReviewClient(fixtureScope.origin, 'a'.repeat(64), async () => {
    throw new Error('unexpected_instruction_request')
  })
  render(
    <ServerStateProvider scope={fixtureScope} client={cache}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        media={media}
        edit={vi.fn()}
        observe={vi.fn()}
        operator={operator}
        operatorReview={{
          batch_id: batch.id,
          revision: batch.revision,
          lots: [],
          retired_lots: [],
          instructions: [],
          cursor: batch.cursor,
        }}
        reload={vi.fn()}
      />
    </ServerStateProvider>,
  )
  await waitFor(() => expect(screen.getByLabelText('Choose photos')).toBeEnabled())
  const note = screen.getByLabelText('Batch instructions')
  await userEvent.setup().type(note, 'Preserve this instruction draft.')
  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'media', batch.id) })
  })
  expect(media.snapshot).toHaveBeenCalledTimes(2)
  expect(cache.getQueryState(serverQueryKey(fixtureScope, 'media', batch.id))?.status).toBe(
    'success',
  )
  expect(note).toHaveValue('Preserve this instruction draft.')
})
