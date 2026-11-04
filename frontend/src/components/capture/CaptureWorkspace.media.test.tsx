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
import type { SettingsPorts } from '../../capture/types'
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

function ports(overrides: Partial<SettingsPorts> = {}): SettingsPorts {
  return {
    connected: true,
    save: vi.fn(() => new Promise<CaptureSnapshotDto>(() => undefined)),
    accept: vi.fn(),
    read: vi.fn(async () => batch),
    ...overrides,
  }
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

test('a pending original pauses settings and keeps its request when Capture rerenders', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  const media = mediaClient()
  const dirty = vi.fn()
  const settings = ports()
  const props = {
    batch,
    busy: false,
    media,
    edit,
    observe: vi.fn(async () => null),
    onDirtyChange: dirty,
    settings,
  }
  const view = render(<CaptureWorkspace {...props} />)
  const input = await screen.findByLabelText('Choose photos')
  const file = new File(['original bytes'], 'bench-photo.png', { type: 'image/png' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, file)

  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.getByText(/Finish or discard the evidence change/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Archive batch' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
  view.rerender(
    <CaptureWorkspace {...props} batch={{ ...batch, updated_at: '2026-11-02T00:01:00Z' }} />,
  )
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  // Batch rebuilds its ports on every render; that must not clear the pending original.
  view.rerender(<CaptureWorkspace {...props} settings={ports({ read: settings.read })} />)
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
  view.rerender(<CaptureWorkspace {...props} />)
  expect(settings.save).not.toHaveBeenCalled()
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
  expect(screen.getByLabelText('Batch title')).toBeEnabled()
  expect(settings.read).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Archive batch' })).toBeEnabled()
})

test('unacknowledged settings freeze file selection until their save is acknowledged', async () => {
  const user = userEvent.setup()

  let acknowledge = () => undefined as void

  const settings = ports({
    save: vi.fn(
      (change) =>
        new Promise<CaptureSnapshotDto>((resolve) => {
          acknowledge = () => resolve({ ...batch, title: change.title, revision: '2' })
        }),
    ),
  })
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      media={mediaClient()}
      edit={vi.fn(async () => undefined)}
      observe={vi.fn(async () => null)}
      settings={settings}
    />,
  )
  const upload = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(upload).toBeEnabled())
  await user.type(screen.getByRole('textbox', { name: 'Batch title' }), ' updated')
  expect(upload).toBeDisabled()
  await waitFor(() => expect(settings.save).toHaveBeenCalledOnce())
  expect(upload).toBeDisabled()
  await act(async () => acknowledge())
  await waitFor(() => expect(upload).toBeEnabled())
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
        settings={ports({ instruct: vi.fn(() => new Promise<never>(() => undefined)) })}
      />
    </ServerStateProvider>,
  )
  await waitFor(() => expect(screen.getByLabelText('Choose photos')).toBeEnabled())
  const note = screen.getByLabelText('Custom instructions')
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

test('an unsaved evidence note freezes media editing until it is saved or discarded', async () => {
  const user = userEvent.setup()
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      media={mediaClient()}
      edit={vi.fn(async () => true)}
      observe={vi.fn(async () => null)}
      onDirtyChange={vi.fn()}
      settings={ports()}
    />,
  )
  const input = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Write a note' }))
  await user.type(screen.getByRole('textbox', { name: 'Evidence note' }), 'Opened packet')
  expect(input).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard note' }))
  await waitFor(() => expect(input).toBeEnabled())
})

test('settings stay paused until the revision after an evidence change is adopted', async () => {
  const user = userEvent.setup()
  let respond: { resolve: (value: CaptureSnapshotDto) => void; reject: (error: unknown) => void }
  const read = vi.fn(
    () =>
      new Promise<CaptureSnapshotDto>((resolve, reject) => {
        respond = { resolve, reject }
      }),
  )
  const settings = ports({ read })
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      media={mediaClient()}
      edit={vi.fn(async () => true)}
      observe={vi.fn(async () => null)}
      onDirtyChange={vi.fn()}
      settings={settings}
    />,
  )
  const input = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, new File(['x'], 'a.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  await act(async () => respond.reject(new TypeError('offline')))
  expect(await screen.findByText(/could not be refreshed after the evidence change/)).toBeVisible()
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Refresh saved settings' }))
  await act(async () => respond.resolve({ ...batch, revision: '2' }))
  expect(settings.accept).toHaveBeenCalledWith({ ...batch, revision: '2' })
  await waitFor(() => expect(screen.getByLabelText('Batch title')).toBeEnabled())
})

for (const order of ['older first', 'newer first'] as const) {
  test(`only the newest post-evidence refresh releases settings (${order})`, async () => {
    const user = userEvent.setup()
    const reads: ((value: CaptureSnapshotDto) => void)[] = []
    const read = vi.fn(() => new Promise<CaptureSnapshotDto>((resolve) => reads.push(resolve)))
    const settings = ports({ read })
    render(
      <CaptureWorkspace
        batch={batch}
        busy={false}
        media={mediaClient()}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        settings={settings}
      />,
    )
    const input = await screen.findByLabelText('Choose photos')
    await waitFor(() => expect(input).toBeEnabled())
    for (const name of ['a.png', 'b.png']) {
      await user.upload(input, new File(['x'], name, { type: 'image/png' }))
      await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
    }
    expect(reads).toHaveLength(2)
    const older = { ...batch, revision: '2' }
    const newer = { ...batch, revision: '3' }
    if (order === 'older first') {
      await act(async () => reads[0](older))
      expect(screen.getByLabelText('Batch title')).toBeDisabled()
      await act(async () => reads[1](newer))
    } else {
      await act(async () => reads[1](newer))
      await act(async () => reads[0](older))
    }
    expect(settings.accept).toHaveBeenCalledTimes(1)
    expect(settings.accept).toHaveBeenCalledWith(newer)
    await waitFor(() => expect(screen.getByLabelText('Batch title')).toBeEnabled())
  })
}

test('an evidence group location is saved through the capture command', async () => {
  const user = userEvent.setup()
  const groupId = '70000000-0000-4000-8000-000000000007'
  const media = mediaClient()
  vi.mocked(media.snapshot).mockResolvedValue({
    ...snapshot,
    groups: [{ id: groupId, label: 'Bag X' }],
  } as MediaSnapshotDto)
  const edit = vi.fn(async () => true)
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      media={media}
      edit={edit}
      observe={vi.fn(async () => null)}
      onDirtyChange={vi.fn()}
      settings={ports()}
    />,
  )
  const field = await screen.findByLabelText('Location for group Bag X')
  await waitFor(() => expect(field).toBeEnabled())
  await user.selectOptions(field, 'clear')
  expect(edit).toHaveBeenCalledWith({
    kind: 'group_location',
    group_id: groupId,
    location: { mode: 'clear' },
  })
})
