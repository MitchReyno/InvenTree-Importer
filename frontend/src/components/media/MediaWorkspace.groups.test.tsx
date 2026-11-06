import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { createServerQueryClient } from '../../queries/client'
import { serverQueryKey } from '../../queries/scope'
import { ServerStateProvider } from '../query/ServerStateProvider'
import { fixtureScope, render } from '../../test/render'
import { MediaWorkspace } from './MediaWorkspace'
import type { MediaClient } from '../../media/types'

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
  await user.click(screen.getByRole('button', { name: 'Retain packet.png' }))
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
  expect(screen.queryByRole('button', { name: 'Retain packet.png' })).toBeNull()
  expect(screen.getByText(/Original retained · 4 bytes/)).toBeVisible()
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
  expect(screen.getByRole('alert')).toHaveTextContent('JPEG or PNG')
  expect(client.upload).not.toHaveBeenCalled()
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
  await user.click(await screen.findByRole('button', { name: 'New evidence group' }))
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
