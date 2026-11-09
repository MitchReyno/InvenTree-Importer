import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { fixtureScope, render } from '#/test/render'
import { MediaWorkspace } from './MediaWorkspace'
import type { MediaClient } from '#/media/types'
import type { OperatorReviewClient } from '#/operator/types'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Grouped packet',
  revision: '1',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '30000000-0000-4000-8000-000000000003', sequence: '0' },
}
const groupA = '40000000-0000-4000-8000-000000000004'
const groupB = '50000000-0000-4000-8000-000000000005'
const front = '60000000-0000-4000-8000-000000000006'
const back = '70000000-0000-4000-8000-000000000007'
const initial: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  groups: [
    { id: groupA, label: 'Packet A' },
    { id: groupB, label: 'Packet B' },
  ],
  evidence: [
    { id: front, label: 'Front label', group_id: groupA, linked_subject_ids: [], versions: [] },
    { id: back, label: 'Back marking', group_id: groupA, linked_subject_ids: [], versions: [] },
  ],
  attachments: [],
  derivations: [],
}

function mediaClient(): MediaClient {
  return {
    snapshot: vi.fn(async () => initial),
    edit: vi.fn(async () => initial),
    upload: vi.fn(async () => {
      throw new Error('unused_upload')
    }),
  }
}

test('three top evidence actions precede named groups and note uses the existing composer', async () => {
  const user = userEvent.setup()
  const writeNote = vi.fn()
  render(
    <MediaWorkspace
      batch={batch}
      client={mediaClient()}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
      onWriteNote={writeNote}
    />,
  )
  const photos = await screen.findByRole('button', { name: 'Take photos' })
  const document = screen.getByRole('button', { name: 'Add document' })
  const note = screen.getByRole('button', { name: 'Write a note' })
  const group = await screen.findByRole('region', { name: /Packet A/ })
  expect(photos.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(note)
  expect(writeNote).toHaveBeenCalledOnce()
  expect(within(group).getByRole('checkbox', { name: 'Select Front label' })).toBeVisible()
  expect(screen.getByRole('region', { name: /Ungrouped/ })).toBeVisible()
})

test('selection moves atomically and conflict preserves the exact selected evidence', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), groupB)
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(vi.mocked(client.edit).mock.calls[0][1]).toEqual({
    expected_revision: '1',
    change: { kind: 'move_many', evidence_ids: [front, back], group_id: groupB },
  })
  expect(screen.getByRole('checkbox', { name: 'Select Front label' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Select Back marking' })).toBeChecked()
})

test('retired group polling cannot unmount a local evidence note draft', async () => {
  const user = userEvent.setup()
  const cache = createServerQueryClient()
  const client = mediaClient()
  render(
    <ServerStateProvider scope={fixtureScope} client={cache}>
      <MediaWorkspace
        batch={batch}
        client={client}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  await user.click(await screen.findByRole('button', { name: 'Edit note for Front label' }))
  const note = screen.getByLabelText('Note for Front label')
  await user.type(note, 'Keep both sides together.')
  await act(async () => {
    cache.setQueryData(serverQueryKey(fixtureScope, 'media', batch.id), {
      ...initial,
      revision: '2',
      groups: initial.groups.filter((group) => group.id !== groupA),
      evidence: initial.evidence.map((item) => ({ ...item, group_id: null })),
    })
  })
  expect(screen.getByLabelText('Note for Front label')).toBe(note)
  expect(note).toHaveValue('Keep both sides together.')
  expect(client.edit).not.toHaveBeenCalled()
})

test('an uncertain note uses one request and closes only after the exact retry is acknowledged', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const saved: MediaSnapshotDto = {
    ...initial,
    revision: '2',
    evidence: initial.evidence.map((item) =>
      item.id === front
        ? {
            ...item,
            note: {
              id: '80000000-0000-4000-8000-000000000008',
              version: '1',
              text: 'Original ink',
              actor_id: batch.actor_id,
              created_at: batch.updated_at,
            },
          }
        : item,
    ),
  }
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost acknowledgment'))
    .mockImplementation(async () => {
      vi.mocked(client.snapshot).mockResolvedValue(saved)
      return saved
    })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  await user.click(await screen.findByRole('button', { name: 'Edit note for Front label' }))
  await user.type(screen.getByRole('textbox', { name: 'Note for Front label' }), 'Original ink')
  await user.click(screen.getByRole('button', { name: 'Save evidence note' }))
  expect(screen.getByRole('textbox', { name: 'Note for Front label' })).toHaveValue('Original ink')
  expect(screen.getByRole('textbox', { name: 'Note for Front label' })).toBeDisabled()
  // The viewer keeps the editor until the request settles, and offers its retry itself.
  const viewer = screen.getByRole('dialog', { name: 'Front label' })
  expect(within(viewer).getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(within(viewer).getByRole('button', { name: 'Retry exact media request' }))
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Note for Front label' })).toBeNull(),
  )
  expect(vi.mocked(client.edit).mock.calls[1]).toEqual(vi.mocked(client.edit).mock.calls[0])
  expect(
    within(screen.getByRole('dialog', { name: 'Front label' })).getByText('Original ink'),
  ).toBeVisible()
})

test('group membership conflict retains one uploaded original in ungrouped without offering to upload again', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const version = {
    id: '80000000-0000-4000-8000-000000000008',
    evidence_id: front,
    kind: 'original' as const,
    digest: 'a'.repeat(64),
    byte_size: '4',
    media_type: 'image/png' as const,
    state: 'queued' as const,
    decoder_build: null,
    recipe: null,
    pages: [],
  }
  const retained: MediaSnapshotDto = {
    ...initial,
    revision: '2',
    evidence: [
      { ...initial.evidence[0], label: 'packet.png', group_id: null, versions: [version] },
    ],
  }
  vi.mocked(client.upload).mockImplementation(async () => {
    vi.mocked(client.snapshot).mockResolvedValue(retained)
    return { status: 'retained', batch_id: batch.id, evidence_id: front, version }
  })
  vi.mocked(client.edit).mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['data'], 'packet.png', { type: 'image/png' }),
  )
  const ungrouped = await screen.findByRole('region', { name: /Ungrouped · 1/ })
  expect(within(ungrouped).getByRole('checkbox', { name: 'Select packet.png' })).toBeChecked()
  expect(client.upload).toHaveBeenCalledOnce()
  expect(client.edit).toHaveBeenCalledWith(
    batch.id,
    {
      expected_revision: '2',
      change: { kind: 'move_many', evidence_ids: [front], group_id: groupA },
    },
    expect.any(String),
  )
  // The notice stays where the file was meant to go; the file itself is in Ungrouped.
  const target = screen.getByRole('region', { name: /Packet A/ })
  const item = await within(target).findByRole('group', { name: 'Upload of packet.png' })
  expect(within(item).getByRole('status')).toHaveTextContent(/Added to Ungrouped/)
  expect(within(item).queryByRole('button', { name: 'Retry packet.png' })).toBeNull()

  // Once the file reaches its group by other means, the notice no longer applies.
  vi.mocked(client.snapshot).mockResolvedValue({
    ...retained,
    revision: '3',
    evidence: [{ ...retained.evidence[0], group_id: groupA }],
  })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() =>
    expect(within(target).queryByRole('group', { name: 'Upload of packet.png' })).toBeNull(),
  )

  // Moved on again later, the dropped notice must not come back with a false claim.
  vi.mocked(client.snapshot).mockResolvedValue({
    ...retained,
    revision: '4',
    evidence: [{ ...retained.evidence[0], group_id: null }],
  })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() => expect(client.snapshot).toHaveBeenLastCalledWith(batch.id))
  expect(screen.queryByRole('group', { name: 'Upload of packet.png' })).toBeNull()
})

test('a held selection after a refused move does not lock Retry or the selection controls', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  let current: MediaSnapshotDto = initial
  vi.mocked(client.snapshot).mockImplementation(async () => current)
  vi.mocked(client.upload).mockImplementation(async (_batch, _revision, label) => {
    if (label === 'two.png') {
      throw new TypeError('network')
    }
    const id = '93000000-0000-4000-8000-000000000009'
    const version = {
      id: 'a3000000-0000-4000-8000-00000000000a',
      evidence_id: id,
      kind: 'original' as const,
      digest: 'd'.repeat(64),
      byte_size: '1',
      media_type: 'image/png' as const,
      state: 'queued' as const,
      decoder_build: null,
      recipe: null,
      pages: [],
    }
    current = {
      ...current,
      revision: String(BigInt(current.revision) + 1n),
      evidence: [
        ...current.evidence,
        { id, label, group_id: null, linked_subject_ids: [], versions: [version] },
      ],
    }
    return { status: 'retained', batch_id: batch.id, evidence_id: id, version }
  })
  vi.mocked(client.edit).mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(screen.getByLabelText('Choose photos'), [
    new File(['1'], 'one.png', { type: 'image/png' }),
    new File(['2'], 'two.png', { type: 'image/png' }),
  ])

  const retry = await screen.findByRole('button', { name: 'Retry two.png' })
  expect(retry).toBeEnabled()
  const clear = screen.getByRole('button', { name: 'Clear evidence selection' })
  expect(clear).toBeEnabled()
  await user.click(clear)
  expect(screen.queryByRole('button', { name: 'Clear evidence selection' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Retry two.png' })).toBeEnabled()
})

test('a poll that fails while a file uploads does not stop the file joining its group', async () => {
  const user = userEvent.setup()
  const queries = createServerQueryClient()
  const key = serverQueryKey(fixtureScope, 'media', batch.id)
  const client = mediaClient()
  const id = '94000000-0000-4000-8000-000000000009'
  const version = {
    id: 'a4000000-0000-4000-8000-00000000000a',
    evidence_id: id,
    kind: 'original' as const,
    digest: 'e'.repeat(64),
    byte_size: '1',
    media_type: 'image/png' as const,
    state: 'queued' as const,
    decoder_build: null,
    recipe: null,
    pages: [],
  }
  const retained: MediaSnapshotDto = {
    ...initial,
    revision: '2',
    evidence: [
      ...initial.evidence,
      { id, label: 'late.png', group_id: null, linked_subject_ids: [], versions: [version] },
    ],
  }

  let acknowledge: () => void = () => undefined

  vi.mocked(client.upload).mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = () =>
          resolve({ status: 'retained', batch_id: batch.id, evidence_id: id, version })
      }),
  )
  vi.mocked(client.edit).mockResolvedValue({
    ...retained,
    revision: '3',
    evidence: retained.evidence.map((item) =>
      item.id === id ? { ...item, group_id: groupA } : item,
    ),
  })
  render(
    <ServerStateProvider scope={fixtureScope} client={queries}>
      <MediaWorkspace
        batch={batch}
        client={client}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['1'], 'late.png', { type: 'image/png' }),
  )
  await waitFor(() => expect(client.upload).toHaveBeenCalledOnce())

  vi.mocked(client.snapshot).mockRejectedValue(new Error('offline'))
  await act(async () => {
    await queries.refetchQueries({ queryKey: key })
  })
  // The workspace now holds the failed read, so its commands are unavailable until a fresh one.
  expect(await screen.findByText(/Current saved media could not be confirmed/)).toBeVisible()
  vi.mocked(client.snapshot).mockResolvedValue(retained)
  await act(async () => acknowledge())

  await waitFor(() =>
    expect(client.edit).toHaveBeenCalledWith(
      batch.id,
      {
        expected_revision: '2',
        change: { kind: 'move_many', evidence_ids: [id], group_id: groupA },
      },
      expect.any(String),
    ),
  )
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'Upload of late.png' })).toBeNull(),
  )
})

function keptVersion(id: string, versionId: string) {
  return {
    id: versionId,
    evidence_id: id,
    kind: 'original' as const,
    digest: 'f'.repeat(64),
    byte_size: '1',
    media_type: 'image/png' as const,
    state: 'queued' as const,
    decoder_build: null,
    recipe: null,
    pages: [],
  }
}

test('reading again a file already placed in a group leaves it there without a selection', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const id = '95000000-0000-4000-8000-000000000009'
  const version = keptVersion(id, 'a5000000-0000-4000-8000-00000000000a')
  vi.mocked(client.upload).mockImplementation(async () => {
    // The read that adopts the receipt fails, so the file waits for Read again.
    vi.mocked(client.snapshot).mockRejectedValueOnce(new Error('offline'))
    return { status: 'retained', batch_id: batch.id, evidence_id: id, version }
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['1'], 'placed.png', { type: 'image/png' }),
  )
  const readAgain = await screen.findByRole('button', { name: 'Read placed.png again' })

  // Meanwhile the file was put in Packet B elsewhere.
  vi.mocked(client.snapshot).mockResolvedValue({
    ...initial,
    revision: '3',
    evidence: [
      ...initial.evidence,
      { id, label: 'placed.png', group_id: groupB, linked_subject_ids: [], versions: [version] },
    ],
  })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() => expect(readAgain).toBeEnabled())
  await user.click(readAgain)

  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'Upload of placed.png' })).toBeNull(),
  )
  expect(client.edit).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Clear evidence selection' })).toBeNull()
})

test('a batch frozen while a file uploads sends no move and holds no selection', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const id = '96000000-0000-4000-8000-000000000009'
  const version = keptVersion(id, 'a6000000-0000-4000-8000-00000000000a')

  let acknowledge: () => void = () => undefined

  vi.mocked(client.upload).mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = () =>
          resolve({ status: 'retained', batch_id: batch.id, evidence_id: id, version })
      }),
  )
  const props = {
    batch,
    client,
    selectedSubject: 'defaults',
    onDirtyChange: vi.fn(),
  }
  const view = render(<MediaWorkspace {...props} disabled={false} />)
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['1'], 'frozen.png', { type: 'image/png' }),
  )
  await waitFor(() => expect(client.upload).toHaveBeenCalledOnce())

  view.rerender(<MediaWorkspace {...props} disabled />)
  vi.mocked(client.snapshot).mockResolvedValue({
    ...initial,
    revision: '2',
    evidence: [
      ...initial.evidence,
      { id, label: 'frozen.png', group_id: null, linked_subject_ids: [], versions: [version] },
    ],
  })
  await act(async () => acknowledge())

  const tile = await screen.findByRole('group', { name: 'Upload of frozen.png' })
  await waitFor(() =>
    expect(within(tile).getByRole('status')).toHaveTextContent(/Added to Ungrouped/),
  )
  expect(client.edit).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Clear evidence selection' })).toBeNull()
})

test('after one move is refused, later files stay in Ungrouped without replacing the selection', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  let current: MediaSnapshotDto = initial
  vi.mocked(client.snapshot).mockImplementation(async () => current)
  vi.mocked(client.upload).mockImplementation(async (_batch, _revision, label) => {
    const id =
      label === 'one.png'
        ? '91000000-0000-4000-8000-000000000009'
        : '92000000-0000-4000-8000-000000000009'
    const version = {
      id:
        label === 'one.png'
          ? 'a1000000-0000-4000-8000-00000000000a'
          : 'a2000000-0000-4000-8000-00000000000a',
      evidence_id: id,
      kind: 'original' as const,
      digest: 'c'.repeat(64),
      byte_size: '1',
      media_type: 'image/png' as const,
      state: 'queued' as const,
      decoder_build: null,
      recipe: null,
      pages: [],
    }
    current = {
      ...current,
      revision: String(BigInt(current.revision) + 1n),
      evidence: [
        ...current.evidence,
        { id, label, group_id: null, linked_subject_ids: [], versions: [version] },
      ],
    }
    return { status: 'retained', batch_id: batch.id, evidence_id: id, version }
  })
  vi.mocked(client.edit).mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(screen.getByLabelText('Choose photos'), [
    new File(['1'], 'one.png', { type: 'image/png' }),
    new File(['2'], 'two.png', { type: 'image/png' }),
  ])

  const target = screen.getByRole('region', { name: /Packet A/ })
  const second = await within(target).findByRole('group', { name: 'Upload of two.png' })
  await waitFor(() =>
    expect(within(second).getByRole('status')).toHaveTextContent(/Added to Ungrouped/),
  )
  expect(client.edit).toHaveBeenCalledOnce()
  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  expect(within(ungrouped).getByRole('checkbox', { name: 'Select one.png' })).toBeChecked()
  expect(within(ungrouped).getByRole('checkbox', { name: 'Select two.png' })).not.toBeChecked()
})

test('a refused file whose group has gone shows its tile in Ungrouped', async () => {
  const user = userEvent.setup({ applyAccept: false })
  const client = mediaClient()
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['gif'], 'late.gif', { type: 'image/gif' }),
  )
  const target = screen.getByRole('region', { name: /Packet A/ })
  expect(within(target).getByRole('group', { name: 'Upload of late.gif' })).toBeVisible()

  vi.mocked(client.snapshot).mockResolvedValue({
    ...initial,
    revision: '2',
    groups: [initial.groups[1]],
    evidence: initial.evidence.map((item) => ({ ...item, group_id: null })),
  })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))

  await waitFor(() => expect(screen.queryByRole('region', { name: /Packet A/ })).toBeNull())
  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  expect(within(ungrouped).getByRole('group', { name: 'Upload of late.gif' })).toBeVisible()
})

test('three photos picked into a group upload one after another and each joins the group', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  let current: MediaSnapshotDto = initial
  vi.mocked(client.snapshot).mockImplementation(async () => current)
  const sent: { name: string; revision: string; key: string }[] = []

  let release: () => void = () => undefined

  vi.mocked(client.upload).mockImplementation(async (_batch, revision, label, _bytes, key) => {
    sent.push({ name: label, revision, key })
    if (sent.length === 2) {
      await new Promise<void>((resolve) => (release = resolve))
    }
    const id = `9000000${sent.length}-0000-4000-8000-000000000009`
    const version = {
      id: `a000000${sent.length}-0000-4000-8000-00000000000a`,
      evidence_id: id,
      kind: 'original' as const,
      digest: 'b'.repeat(64),
      byte_size: '4',
      media_type: 'image/png' as const,
      state: 'queued' as const,
      decoder_build: null,
      recipe: null,
      pages: [],
    }
    current = {
      ...current,
      revision: String(BigInt(current.revision) + 1n),
      evidence: [
        ...current.evidence,
        { id, label, group_id: null, linked_subject_ids: [], versions: [version] },
      ],
    }
    return { status: 'retained', batch_id: batch.id, evidence_id: id, version }
  })
  vi.mocked(client.edit).mockImplementation(async (_batch, input) => {
    if (input.change.kind !== 'move_many') {
      throw new Error('unexpected_edit')
    }
    const { evidence_ids, group_id } = input.change
    current = {
      ...current,
      revision: String(BigInt(current.revision) + 1n),
      evidence: current.evidence.map((item) =>
        evidence_ids.includes(item.id) ? { ...item, group_id } : item,
      ),
    }
    return current
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add photos to Packet A' }))
  await user.upload(screen.getByLabelText('Choose photos'), [
    new File(['1'], 'one.png', { type: 'image/png' }),
    new File(['2'], 'two.png', { type: 'image/png' }),
    new File(['3'], 'three.png', { type: 'image/png' }),
  ])

  const group = screen.getByRole('region', { name: /Packet A/ })
  await waitFor(() => expect(within(group).getByText(/Uploading 2 of 3/)).toBeVisible())
  // The file uploading and the one waiting show as tiles in the group's own grid.
  expect(within(group).getByRole('group', { name: 'Upload of two.png' })).toHaveTextContent(
    'Uploading…',
  )
  expect(within(group).getByRole('group', { name: 'Upload of three.png' })).toBeVisible()
  expect(
    within(screen.getByRole('region', { name: /Ungrouped/ })).queryByRole('group', {
      name: /^Upload of/,
    }),
  ).toBeNull()
  await act(async () => release())
  await waitFor(() => expect(client.upload).toHaveBeenCalledTimes(3))
  await waitFor(() =>
    expect(within(group).getByRole('checkbox', { name: 'Select three.png' })).toBeVisible(),
  )
  expect(within(group).getByRole('checkbox', { name: 'Select one.png' })).toBeVisible()
  expect(within(group).getByRole('checkbox', { name: 'Select two.png' })).toBeVisible()
  expect(within(group).queryByText(/Uploading/)).toBeNull()
  // Each upload starts at the revision current after the previous file joined the group.
  expect(sent.map((item) => item.revision)).toEqual(['1', '3', '5'])
  expect(new Set(sent.map((item) => item.key)).size).toBe(3)
})

test('unsupported media is refused before any upload intent is sent', async () => {
  const user = userEvent.setup({ applyAccept: false })
  const client = mediaClient()
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  const input = screen.getByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, new File(['bad'], 'packet.gif', { type: 'image/gif' }))
  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  const item = within(ungrouped).getByRole('group', { name: 'Upload of packet.gif' })
  expect(within(item).getByRole('alert')).toHaveTextContent(/Not added.*JPEG or PNG/)
  expect(client.upload).not.toHaveBeenCalled()
  await user.click(within(item).getByRole('button', { name: 'Dismiss packet.gif' }))
  expect(within(ungrouped).queryByRole('group', { name: 'Upload of packet.gif' })).toBeNull()
  expect(document.activeElement).not.toBe(document.body)
})

test('a saved note remains acknowledged when its follow-up read fails', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockImplementation(async () => {
    vi.mocked(client.snapshot).mockRejectedValue(new Error('read offline'))
    return { ...initial, revision: '2' }
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  await user.click(await screen.findByRole('button', { name: 'Edit note for Front label' }))
  await user.type(screen.getByRole('textbox', { name: 'Note for Front label' }), 'Retained ink')
  await user.click(screen.getByRole('button', { name: 'Save evidence note' }))
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Note for Front label' })).toBeNull(),
  )
  expect(screen.getByText(/Change saved. The subsequent read failed/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry exact media request' })).toBeNull()
  expect(client.edit).toHaveBeenCalledOnce()
})

test('an older completed read cannot roll back acknowledged membership', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValue({
    ...initial,
    revision: '2',
    evidence: initial.evidence.map((item) =>
      item.id === front ? { ...item, group_id: groupB } : item,
    ),
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), groupB)
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  const destination = await screen.findByRole('region', { name: /Packet B · 1/ })
  await waitFor(() =>
    expect(
      within(destination).getByRole('checkbox', { name: 'Select Front label' }),
    ).not.toBeChecked(),
  )
  expect(screen.getByRole('region', { name: /Packet A · 1/ })).toBeVisible()
})

test('exact retry closes an acknowledged new-group draft', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost acknowledgment'))
    .mockResolvedValue({
      ...initial,
      revision: '2',
      groups: [
        ...initial.groups,
        { id: '80000000-0000-4000-8000-000000000008', label: 'Third packet' },
      ],
    })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'New group' }))
  await user.type(screen.getByRole('textbox', { name: 'New group name' }), 'Third packet')
  await user.click(screen.getByRole('button', { name: 'Create group' }))
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New group name' })).toBeNull())
  expect(vi.mocked(client.edit).mock.calls[1]).toEqual(vi.mocked(client.edit).mock.calls[0])
  expect(screen.getByRole('region', { name: /Third packet/ })).toBeVisible()
})

test('duplicate filenames have distinct exact-identity selection, drag and note controls', async () => {
  const client = mediaClient()
  vi.mocked(client.snapshot).mockResolvedValue({
    ...initial,
    evidence: initial.evidence.map((item) => ({ ...item, label: 'photo.png' })),
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  const first = await screen.findByRole('checkbox', { name: 'Select photo.png (1)' })
  const second = screen.getByRole('checkbox', { name: 'Select photo.png (2)' })
  expect(first).not.toBe(second)
  expect(screen.getByRole('button', { name: /Drag photo.png \(1\)/ })).toBeVisible()
  // Files sharing a name are numbered, so each control names one file.
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open photo.png (2)' }))
  expect(screen.getByRole('button', { name: 'Edit note for photo.png (2)' })).toBeVisible()
})

test('the viewer cannot close over an unsaved note, so the draft is never lost', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const onDirtyChange = vi.fn()
  render(
    <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
      <MediaWorkspace
        batch={batch}
        client={client}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={onDirtyChange}
      />
    </ServerStateProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  await user.click(screen.getByRole('button', { name: 'Edit note for Front label' }))
  await user.type(screen.getByLabelText('Note for Front label'), 'Keep both sides together.')
  const viewer = screen.getByRole('dialog', { name: 'Front label' })

  expect(within(viewer).getByRole('button', { name: 'Close' })).toBeDisabled()
  // jsdom does not turn Escape into the dialog's cancel event, so send it as the browser does.
  fireEvent(viewer, new Event('cancel', { cancelable: true }))
  expect(screen.getByLabelText('Note for Front label')).toHaveValue('Keep both sides together.')

  await user.click(within(viewer).getByRole('button', { name: /^Discard note for front label/i }))
  expect(within(viewer).getByRole('button', { name: 'Close' })).toBeEnabled()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a read-only workspace still lets the viewer close', async () => {
  const user = userEvent.setup()
  render(
    <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
      <MediaWorkspace
        batch={batch}
        client={mediaClient()}
        disabled
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  expect(
    within(screen.getByRole('dialog', { name: 'Front label' })).getByRole('button', {
      name: 'Close',
    }),
  ).toBeEnabled()

  fireEvent(
    screen.getByRole('dialog', { name: 'Front label' }),
    new Event('cancel', { cancelable: true }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a refused retry of an uncertain note keeps the typed text in the viewer', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost acknowledgment'))
    .mockRejectedValueOnce(new IntakeRequestError(409, 'revision_conflict'))
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Open Front label' }))
  await user.click(screen.getByRole('button', { name: 'Edit note for Front label' }))
  await user.type(screen.getByLabelText('Note for Front label'), 'Original ink')
  await user.click(screen.getByRole('button', { name: 'Save evidence note' }))
  const viewer = screen.getByRole('dialog', { name: 'Front label' })
  await user.click(within(viewer).getByRole('button', { name: 'Retry exact media request' }))

  await waitFor(() =>
    expect(within(viewer).queryByRole('button', { name: 'Retry exact media request' })).toBeNull(),
  )
  expect(screen.getByLabelText('Note for Front label')).toHaveValue('Original ink')
  // The page behind the modal is inert, so the viewer says why the save was refused.
  expect(within(viewer).getByRole('alert')).toBeInTheDocument()
  expect(within(viewer).getByRole('button', { name: 'Close' })).toBeDisabled()
})

test('renames a group inline and keeps each file’s move handle on its tile', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  const name = await screen.findByRole('textbox', { name: 'Name for Packet A' })

  await user.clear(name)
  await user.type(name, 'Resistor bag{Enter}')
  expect(client.edit).toHaveBeenCalledWith(
    batch.id,
    {
      expected_revision: '1',
      change: { kind: 'rename_group', group_id: groupA, label: 'Resistor bag' },
    },
    expect.any(String),
  )

  const group = screen.getByRole('region', { name: /Packet A/ })
  const tile = within(group).getByRole('button', { name: 'Open Front label' }).parentElement!
  expect(within(tile).getByRole('button', { name: 'Drag Front label' })).toBeVisible()
  expect(within(group).queryByText('Move evidence')).not.toBeInTheDocument()
  expect(within(group).getByRole('button', { name: 'Ungroup Packet A' })).toBeVisible()
})

test('heads the evidence with its file and group counts beside New group', async () => {
  render(
    <MediaWorkspace
      batch={batch}
      client={mediaClient()}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
      headingId="evidence"
    />,
  )
  const heading = await screen.findByRole('heading', { name: 'Evidence' })
  expect(heading).toHaveAttribute('id', 'evidence')
  expect(await screen.findByText('2 files · 2 groups')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New group' })).toBeVisible()
})

test('opens a file’s note from its tile', async () => {
  const user = userEvent.setup()
  render(
    <MediaWorkspace
      batch={batch}
      client={mediaClient()}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Note: Front label' }))
  expect(screen.getByRole('textbox', { name: 'Note for Front label' })).toBeVisible()
  expect(screen.getByRole('region', { name: /Packet A/ })).toHaveTextContent('2 files · 0 lots')
})

test('confirms a move with a toast whose Undo moves the files back', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValueOnce({
    ...initial,
    revision: '2',
    evidence: initial.evidence.map((item) =>
      item.id === front ? { ...item, group_id: groupB } : item,
    ),
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), 'Packet B')
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))

  const toast = await screen.findByText('Moved 1 file to Packet B')
  await user.click(within(toast.parentElement!).getByRole('button', { name: 'Undo' }))
  await waitFor(() =>
    expect(client.edit).toHaveBeenLastCalledWith(
      batch.id,
      expect.objectContaining({
        change: { kind: 'move_many', evidence_ids: [front], group_id: groupA },
      }),
      expect.any(String),
    ),
  )
})

test('Undo waits while another draft is open, so the draft is not lost', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValueOnce({
    ...initial,
    revision: '2',
    evidence: initial.evidence.map((item) =>
      item.id === front ? { ...item, group_id: groupB } : item,
    ),
  })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), 'Packet B')
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  const toast = await screen.findByText('Moved 1 file to Packet B')
  await user.click(screen.getByRole('button', { name: 'New group' }))
  await user.type(screen.getByRole('textbox', { name: 'New group name' }), 'Third')
  expect(within(toast.parentElement!).queryByRole('button', { name: 'Undo' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'New group name' })).toHaveValue('Third')
})

test('a retired lot no longer counts among the lots a group feeds', async () => {
  const lot = (id: string, retired: boolean) =>
    ({ id, label: id, retired }) as unknown as CaptureSnapshotDto['lots'][number]

  const client = mediaClient()
  vi.mocked(client.snapshot).mockResolvedValue({
    ...initial,
    evidence: initial.evidence.map((item) => ({ ...item, linked_subject_ids: ['old', 'new'] })),
  })
  const props = {
    batch: { ...batch, lots: [lot('old', true), lot('new', false)] },
    client,
    disabled: false,
    selectedSubject: 'defaults',
    onDirtyChange: vi.fn(),
  }
  const view = render(<MediaWorkspace {...props} />)
  // Until the review's lineage is read, the count is withheld rather than shown as zero.
  expect(await screen.findByRole('region', { name: /Packet A/ })).not.toHaveTextContent('lot')
  view.rerender(
    <MediaWorkspace
      {...props}
      review={{ retired_lots: [{ lot_id: 'old', successor_lot_ids: ['new'] }] } as never}
    />,
  )
  expect(screen.getByRole('region', { name: /Packet A/ })).toHaveTextContent('2 files · 1 lot')
})

test('a move confirmed by an exact retry still raises its toast', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost_ack'))
    .mockResolvedValueOnce({
      ...initial,
      revision: '2',
      evidence: initial.evidence.map((item) =>
        item.id === front ? { ...item, group_id: groupB } : item,
      ),
    })
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), 'Packet B')
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))
  expect(await screen.findByText('Moved 1 file to Packet B')).toBeInTheDocument()
})

test('a group’s instruction draft reaches the guard and is released when the workspace closes', async () => {
  const user = userEvent.setup()
  const onDirtyChange = vi.fn()
  const review = { instructions: [] } as unknown as OperatorReviewDto
  const operator = { instruct: vi.fn() } as unknown as OperatorReviewClient
  const view = render(
    <MediaWorkspace
      batch={batch}
      client={mediaClient()}
      disabled={false}
      selectedSubject="defaults"
      review={review}
      reload={vi.fn(async () => undefined)}
      onDirtyChange={onDirtyChange}
    />,
    { clients: { operator } },
  )
  await user.click(await screen.findByRole('button', { name: 'Edit note for group Packet A' }))
  await user.type(screen.getByLabelText('Group “Packet A”'), 'Keep apart')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  view.unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

function renderNewGroup(client: MediaClient) {
  const onDirtyChange = vi.fn()
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={onDirtyChange}
    />,
  )
  return { onDirtyChange }
}

test('a confirmed new group closes its form and releases the guard', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const { onDirtyChange } = renderNewGroup(client)
  await user.click(await screen.findByRole('button', { name: 'New group' }))
  await user.type(screen.getByLabelText('New group name'), 'Packet C')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Create group' }))
  await waitFor(() => expect(screen.queryByLabelText('New group name')).not.toBeInTheDocument())
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('an unconfirmed new group closes once its exact retry is confirmed', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValueOnce(new Error('lost'))
  renderNewGroup(client)
  await user.click(await screen.findByRole('button', { name: 'New group' }))
  await user.type(screen.getByLabelText('New group name'), 'Packet C')
  await user.click(screen.getByRole('button', { name: 'Create group' }))
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))
  await waitFor(() => expect(screen.queryByLabelText('New group name')).not.toBeInTheDocument())
  expect(vi.mocked(client.edit).mock.calls[1][2]).toBe(vi.mocked(client.edit).mock.calls[0][2])
})

test('a refused new group keeps its name for another try', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValueOnce(new IntakeRequestError(422, 'invalid_group'))
  renderNewGroup(client)
  await user.click(await screen.findByRole('button', { name: 'New group' }))
  await user.type(screen.getByLabelText('New group name'), 'Packet C')
  await user.click(screen.getByRole('button', { name: 'Create group' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(screen.getByLabelText('New group name')).toHaveValue('Packet C')
})

function renderMoves(client: MediaClient) {
  render(
    <MediaWorkspace
      batch={batch}
      client={client}
      disabled={false}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
}

async function moveFrontToB(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.selectOptions(screen.getByLabelText('Move selected evidence to'), groupB)
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
}

test('an unconfirmed move that its exact retry confirms is announced with Undo', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValueOnce(new Error('lost'))
  renderMoves(client)
  await moveFrontToB(user)
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))
  expect(await screen.findByText('Moved 1 file to Packet B')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible()
})

test('an unconfirmed move that its retry has refused is never announced', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost'))
    .mockRejectedValueOnce(new IntakeRequestError(422, 'group_not_found'))
  renderMoves(client)
  await moveFrontToB(user)
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('Moved 1 file to Packet B')).toBeNull()
})
