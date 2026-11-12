import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { fixtureScope, render } from '#/test/render'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import type { MediaClient } from '#/media/types'
import { MediaWorkspace } from './MediaWorkspace'

const lotA = 'a0000000-0000-4000-8000-00000000000a'
const lotB = 'b0000000-0000-4000-8000-00000000000b'
const partX = 'c0000000-0000-4000-8000-00000000000c'
const groupA = '40000000-0000-4000-8000-000000000004'
const front = '60000000-0000-4000-8000-000000000006'
const back = '70000000-0000-4000-8000-000000000007'
const approval = '80000000-0000-4000-8000-000000000008'
const thumbnail = '90000000-0000-4000-8000-000000000009'

function lot(id: string, label: string) {
  return {
    id,
    label,
    revision: '1',
    contribution_key: id,
    part_subject_id: null,
    quantity: { mode: 'unknown' },
    location: { mode: 'unset' },
  }
}

const batch = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Removal',
  revision: '1',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  lots: [lot(lotA, 'Packet A'), lot(lotB, 'Loose reel')],
  parts: [{ id: partX, label: '1N4148', revision: '1', choice: { mode: 'unset' } }],
  notes: [],
  observations: [],
  cursor: { stream_id: '30000000-0000-4000-8000-000000000003', sequence: '0' },
} as unknown as CaptureSnapshotDto

const present: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '4',
  groups: [{ id: groupA, label: 'Packet A' }],
  evidence: [
    {
      id: front,
      label: 'Front label',
      group_id: groupA,
      linked_subject_ids: [lotA, lotB],
      versions: [],
      lot_ids: [lotA, lotB],
      sole_evidence_lot_ids: [lotB],
      selected_attachment_of: [{ subject_id: partX, destination: 'part_attachment' }],
    },
    { id: back, label: 'Back marking', group_id: groupA, linked_subject_ids: [], versions: [] },
  ],
  attachments: [],
  derivations: [],
}

const afterRemoval: MediaSnapshotDto = {
  ...present,
  revision: '5',
  evidence: present.evidence.filter((item) => item.id !== front),
  removed: [
    {
      id: front,
      label: 'Front label',
      preview_id: thumbnail,
      removed_revision: '5',
      removed_at: '2026-11-04T00:00:00Z',
      position: 0,
    },
  ],
}

function mediaClient(snapshot = present): MediaClient {
  return {
    snapshot: vi.fn(async () => snapshot),
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(async () => {
      throw new Error('unused_upload')
    }),
    removalImpact: vi.fn(async (_batchId: string, ids: readonly string[]) => ({
      evidence_ids: [...ids],
      lot_ids: [lotA, lotB],
      sole_evidence_lot_ids: [lotA, lotB],
      selected_attachment_of: [],
    })),
  }
}

function workspace(client: MediaClient, workspaceBatch: CaptureSnapshotDto, disabled: boolean) {
  return (
    <MediaWorkspace
      batch={workspaceBatch}
      client={client}
      disabled={disabled}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />
  )
}

function renderWorkspace(client: MediaClient, workspaceBatch = batch, disabled = false) {
  const view = render(workspace(client, workspaceBatch, disabled))
  return {
    archive: () => view.rerender(workspace(client, { ...workspaceBatch, archived: true }, true)),
  }
}

/** A ready original with one decoded page, so the file has a thumbnail. */
function withPage(item: MediaSnapshotDto['evidence'][number], previewId: string) {
  return {
    ...item,
    versions: [
      {
        id: `${previewId.slice(0, -1)}1`,
        evidence_id: item.id,
        kind: 'original' as const,
        digest: `sha256:${'0'.repeat(64)}`,
        byte_size: '100',
        media_type: 'image/jpeg' as const,
        state: 'ready' as const,
        decoder_build: 'test',
        recipe: null,
        pages: [{ page: 1, width: 400, height: 300, preview_id: previewId }],
      },
    ],
  }
}

async function chooseDelete(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
}

test('the delete dialog names the lots, the lot left without evidence and the cleared selection', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await chooseDelete(user, 'Front label')

  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  expect(within(dialog).getByRole('list', { name: 'Lots that use it' })).toHaveTextContent(
    /Packet A.*Loose reel/,
  )
  expect(within(dialog).getByText(/Loose reel will have no supporting evidence/)).toHaveTextContent(
    /no note or linked media supports it/,
  )
  expect(
    within(dialog).getByRole('list', { name: 'Attachment choices it clears' }),
  ).toHaveTextContent('1N4148 · Part attachment')
  expect(client.removalImpact).not.toHaveBeenCalled()
  expect(client.edit).not.toHaveBeenCalled()

  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus()
})

test('a confirmed delete sends remove, and Undo sends restore and focuses the file again', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValueOnce(afterRemoval).mockResolvedValueOnce(present)
  vi.mocked(client.snapshot).mockResolvedValue(present)
  renderWorkspace(client)
  await chooseDelete(user, 'Front label')
  vi.mocked(client.snapshot).mockResolvedValue(afterRemoval)
  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete file' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(vi.mocked(client.edit).mock.calls[0][1]).toEqual({
    expected_revision: '4',
    change: { kind: 'remove', evidence_ids: [front] },
  })
  expect(screen.queryByRole('button', { name: 'Open Front label' })).toBeNull()
  expect(screen.getByRole('region', { name: /Packet A/ })).toHaveFocus()
  expect(await screen.findByText('Deleted Front label')).toBeVisible()

  vi.mocked(client.snapshot).mockResolvedValue(present)
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledTimes(2))
  expect(vi.mocked(client.edit).mock.calls[1][1]).toEqual({
    expected_revision: '5',
    change: { kind: 'restore', evidence_ids: [front] },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus(),
  )
  expect(screen.queryByText('Deleted Front label')).toBeNull()
})

test('Deleted files lists each file with its thumbnail and label, and Restore sends restore', async () => {
  const user = userEvent.setup()
  const client = mediaClient(afterRemoval)
  vi.mocked(client.edit).mockResolvedValueOnce(present)
  renderWorkspace(client)
  await user.click(await screen.findByText('Deleted files · 1'))

  const list = screen.getByRole('list', { name: 'Deleted files' })
  const image = list.querySelector('img')
  expect(image?.getAttribute('src')).toContain(`/media/previews/${thumbnail}?size=thumb`)
  expect(within(list).getByText('Front label')).toBeVisible()
  vi.mocked(client.snapshot).mockResolvedValue(present)
  await user.click(within(list).getByRole('button', { name: 'Restore Front label' }))

  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(vi.mocked(client.edit).mock.calls[0][1]).toEqual({
    expected_revision: '5',
    change: { kind: 'restore', evidence_ids: [front] },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus(),
  )
})

test('Restore is disabled with its reason in an archived batch', async () => {
  const user = userEvent.setup()
  renderWorkspace(mediaClient(afterRemoval), { ...batch, archived: true }, true)
  await user.click(await screen.findByText('Deleted files · 1'))

  const restore = screen.getByRole('button', { name: 'Restore Front label' })
  expect(restore).toBeDisabled()
  expect(restore).toHaveAccessibleDescription('Resume the batch to restore files.')
})

test('Delete is disabled with the approval that used the file, and nothing is sent', async () => {
  const user = userEvent.setup()
  const pinned: MediaSnapshotDto = {
    ...present,
    evidence: present.evidence.map((item) =>
      item.id === front
        ? { ...item, pinned_by: { approval_id: approval, approved_at: '2026-10-14T03:00:00Z' } }
        : item,
    ),
  }
  const client = mediaClient(pinned)
  renderWorkspace(client)
  await chooseDelete(user, 'Front label')

  const remove = screen.getByRole('menuitem', { name: 'Delete…' })
  expect(remove).toHaveAttribute('aria-disabled', 'true')
  expect(remove).toHaveAccessibleDescription(
    /^Used by the approval on .+\. It stays as the record of what was added\.$/,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(client.edit).not.toHaveBeenCalled()
})

test('a refused delete keeps the file and says why', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValueOnce(new IntakeRequestError(409, 'media_removal_refused'))
  renderWorkspace(client)
  await chooseDelete(user, 'Front label')
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: 'Open Front label' })).toBeVisible()
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.queryByText('Deleted Front label')).toBeNull()
  expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus()
})

test('Delete N files reads the combined impact and removes the selection in one command', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByRole('button', { name: 'Delete 2 files…' }))

  const dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' })
  expect(
    await within(dialog).findByText(/Packet A and Loose reel will have no supporting evidence/),
  ).toBeVisible()
  expect(client.removalImpact).toHaveBeenCalledWith(batch.id, [front, back])
  expect(within(dialog).queryByRole('list', { name: 'Attachment choices it clears' })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Delete 2 files' }))

  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(vi.mocked(client.edit).mock.calls[0][1]).toEqual({
    expected_revision: '4',
    change: { kind: 'remove', evidence_ids: [front, back] },
  })
})

test('a failed impact read keeps Delete N files disabled until it is read', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.removalImpact).mockRejectedValueOnce(new Error('offline'))
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByRole('button', { name: 'Delete 2 files…' }))

  const dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' })
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/couldn’t be checked/)
  expect(within(dialog).getByRole('button', { name: 'Delete 2 files' })).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: 'Check again' }))
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Delete 2 files' })).toBeEnabled(),
  )
  expect(client.edit).not.toHaveBeenCalled()
})

test('Delete N files is disabled with the reason when an approval used a selected file', async () => {
  const user = userEvent.setup()
  const client = mediaClient({
    ...present,
    evidence: present.evidence.map((item) =>
      item.id === back
        ? { ...item, pinned_by: { approval_id: approval, approved_at: '2026-10-14T03:00:00Z' } }
        : item,
    ),
  })
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))

  const bulk = screen.getByRole('button', { name: 'Delete 2 files…' })
  expect(bulk).toBeDisabled()
  expect(bulk).toHaveAccessibleDescription(
    'Back marking was used by an approval. It stays as the record of what was added.',
  )
})

test('the delete dialog shows the file it deletes and says its note goes with it', async () => {
  const user = userEvent.setup()
  const pictured = {
    ...present,
    evidence: present.evidence.map((item) =>
      item.id === front ? withPage(item, thumbnail) : item,
    ),
  }
  renderWorkspace(mediaClient(pictured))
  await chooseDelete(user, 'Front label')

  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  const figure = within(dialog).getByRole('figure', { name: 'Front label' })
  expect(figure.querySelector('img')?.getAttribute('src')).toContain(
    `/media/previews/${thumbnail}?size=thumb`,
  )
  expect(dialog).toHaveTextContent(
    'It leaves the batch and what agents read, and its note goes with it.',
  )
})

test('deleting several files shows the first few of them', async () => {
  const user = userEvent.setup()
  const second = 'd0000000-0000-4000-8000-00000000000d'
  const pictured = {
    ...present,
    evidence: [withPage(present.evidence[0], thumbnail), withPage(present.evidence[1], second)],
  }
  renderWorkspace(mediaClient(pictured))
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByRole('button', { name: 'Delete 2 files…' }))

  const dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' })
  const files = within(dialog).getByRole('list', { name: 'Files to delete' })
  expect(
    within(files)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Front label', 'Back marking'])
  expect(files.querySelectorAll('img')).toHaveLength(2)
})

test('Undo leaves the toast and Restore is disabled once the batch is archived', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValueOnce(afterRemoval)
  const view = renderWorkspace(client)
  await chooseDelete(user, 'Front label')
  vi.mocked(client.snapshot).mockResolvedValue(afterRemoval)
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))
  expect(await screen.findByRole('button', { name: 'Undo' })).toBeVisible()

  view.archive()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  await user.click(screen.getByText('Deleted files · 1'))
  expect(screen.getByRole('button', { name: 'Restore Front label' })).toBeDisabled()
  expect(client.edit).toHaveBeenCalledOnce()
})

test('Move to group… is disabled while another selection is held', async () => {
  const user = userEvent.setup()
  renderWorkspace(mediaClient())
  await user.click(await screen.findByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByRole('button', { name: 'Actions for Front label' }))

  expect(
    await screen.findByRole('menuitem', { name: 'Move to group…' }),
  ).toHaveAccessibleDescription('Clear the selection first.')
})

test('Move to group… selects the file and focuses the existing move control', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await user.click(await screen.findByRole('button', { name: 'Actions for Front label' }))
  await user.keyboard('{ArrowDown}{Enter}')

  const destination = screen.getByLabelText('Move selected evidence to')
  await waitFor(() => expect(destination).toHaveFocus())
  expect(destination).toHaveValue('')
  expect(screen.getByRole('checkbox', { name: 'Select Front label' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Select Back marking' })).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(vi.mocked(client.edit).mock.calls[0][1]).toEqual({
    expected_revision: '4',
    change: { kind: 'move_many', evidence_ids: [front], group_id: null },
  })
})

test('Move to group… is disabled with its reason when there is nowhere to move the file', async () => {
  const user = userEvent.setup()
  renderWorkspace(
    mediaClient({
      ...present,
      groups: [],
      evidence: present.evidence.map((item) => ({ ...item, group_id: null })),
    }),
  )
  await user.click(await screen.findByRole('button', { name: 'Actions for Front label' }))
  const move = await screen.findByRole('menuitem', { name: 'Move to group…' })

  expect(move).toHaveAttribute('aria-disabled', 'true')
  expect(move).toHaveAccessibleDescription(
    'There’s no other group to move it to. Add a group first.',
  )
  await user.click(move)
  expect(screen.queryByLabelText('Move selected evidence to')).toBeNull()
})

test('Move to group… is disabled with its reason in an archived batch', async () => {
  const user = userEvent.setup()
  renderWorkspace(mediaClient(), { ...batch, archived: true }, true)
  await user.click(await screen.findByRole('button', { name: 'Actions for Front label' }))

  expect(
    await screen.findByRole('menuitem', { name: 'Move to group…' }),
  ).toHaveAccessibleDescription('Resume the batch to move files.')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('a held selection moves at the revision a delete confirmed', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockResolvedValueOnce(afterRemoval).mockResolvedValueOnce(afterRemoval)
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Back marking' }))
  await chooseDelete(user, 'Front label')
  vi.mocked(client.snapshot).mockResolvedValue(afterRemoval)
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))
  await screen.findByText('Deleted Front label')

  expect(screen.getByRole('checkbox', { name: 'Select Back marking' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledTimes(2))
  expect(vi.mocked(client.edit).mock.calls[1][1]).toEqual({
    expected_revision: '5',
    change: { kind: 'move_many', evidence_ids: [back], group_id: null },
  })
})

test('a held selection moves at the revision a restore confirmed', async () => {
  const user = userEvent.setup()
  const restored = { ...present, revision: '6' }
  const client = mediaClient(afterRemoval)
  vi.mocked(client.edit).mockResolvedValueOnce(restored).mockResolvedValueOnce(restored)
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByText('Deleted files · 1'))
  vi.mocked(client.snapshot).mockResolvedValue(restored)
  await user.click(screen.getByRole('button', { name: 'Restore Front label' }))
  await screen.findByRole('button', { name: 'Open Front label' })

  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledTimes(2))
  expect(vi.mocked(client.edit).mock.calls[1][1]).toMatchObject({ expected_revision: '6' })
})

test('an uncertain delete confirmed by Retry shows its toast and keeps the rest of the selection', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit)
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(afterRemoval)
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await chooseDelete(user, 'Front label')
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))
  vi.mocked(client.snapshot).mockResolvedValue(afterRemoval)
  await user.click(await screen.findByRole('button', { name: 'Retry exact media request' }))

  expect(await screen.findByText('Deleted Front label')).toBeVisible()
  expect(vi.mocked(client.edit).mock.calls[1][2]).toBe(vi.mocked(client.edit).mock.calls[0][2])
  expect(screen.getByRole('checkbox', { name: 'Select Back marking' })).toBeChecked()
})

test('an earlier uncertain move keeps the delete confirmation disabled and claims no delete', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  vi.mocked(client.edit).mockRejectedValueOnce(new Error('lost'))
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await screen.findByRole('button', { name: 'Retry exact media request' })
  await user.click(screen.getByRole('button', { name: 'Actions for Back marking' }))

  const remove = await screen.findByRole('menuitem', { name: 'Delete…' })
  expect(remove).toHaveAccessibleDescription(
    'Delete waits until the unconfirmed evidence change is retried or discarded.',
  )
  await user.click(remove)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(client.edit).toHaveBeenCalledOnce()
})

test('an unread snapshot gives Delete its own reason', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await screen.findByRole('button', { name: 'Actions for Front label' })
  vi.mocked(client.snapshot).mockRejectedValue(new Error('offline'))
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await screen.findByText(/Current saved media could not be confirmed/)
  await user.click(screen.getByRole('button', { name: 'Actions for Front label' }))

  expect(await screen.findByRole('menuitem', { name: 'Delete…' })).toHaveAccessibleDescription(
    'Delete waits for a fresh read of the saved evidence.',
  )
})

test('Restore gives no reason while another restore is being sent', async () => {
  const user = userEvent.setup()
  const twoRemoved: MediaSnapshotDto = {
    ...afterRemoval,
    evidence: [],
    removed: [
      ...afterRemoval.removed!,
      { ...afterRemoval.removed![0], id: back, label: 'Back marking', position: 1 },
    ],
  }
  const client = mediaClient(twoRemoved)
  const sending = deferred<MediaSnapshotDto>()
  vi.mocked(client.edit).mockReturnValueOnce(sending.promise)
  renderWorkspace(client)
  await user.click(await screen.findByText('Deleted files · 2'))
  await user.click(screen.getByRole('button', { name: 'Restore Front label' }))

  const other = screen.getByRole('button', { name: 'Restore Back marking' })
  expect(other).toBeDisabled()
  expect(other).not.toHaveAccessibleDescription()
  await act(async () => sending.resolve(twoRemoved))
})

test('reopening Delete N files reads the impact again before Delete is enabled', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await user.click(await screen.findByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Back marking' }))
  await user.click(screen.getByRole('button', { name: 'Delete 2 files…' }))
  let dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' })
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Delete 2 files' })).toBeEnabled(),
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  const reread = deferred<Awaited<ReturnType<MediaClient['removalImpact']>>>()
  vi.mocked(client.removalImpact).mockReturnValueOnce(reread.promise)
  await user.click(screen.getByRole('button', { name: 'Delete 2 files…' }))
  dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' })
  expect(within(dialog).getByRole('button', { name: 'Delete 2 files' })).toBeDisabled()
  expect(within(dialog).getByRole('status')).toHaveTextContent('Checking which lots use them…')
  expect(client.removalImpact).toHaveBeenCalledTimes(2)
  await act(async () =>
    reread.resolve({
      evidence_ids: [front, back],
      lot_ids: [],
      sole_evidence_lot_ids: [],
      selected_attachment_of: [],
    }),
  )
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Delete 2 files' })).toBeEnabled(),
  )
})

test('the header counts deleted files towards the 200-file limit', async () => {
  renderWorkspace(mediaClient(afterRemoval))

  expect(
    await screen.findByText('1 file · 1 deleted, counting towards 200 · 1 group'),
  ).toBeVisible()
})

test('Deleted files numbers files that share a name, as the tiles do', async () => {
  const user = userEvent.setup()
  renderWorkspace(
    mediaClient({
      ...afterRemoval,
      evidence: [],
      removed: [
        ...afterRemoval.removed!,
        { ...afterRemoval.removed![0], id: back, preview_id: null, position: 1 },
      ],
    }),
  )
  await user.click(await screen.findByText('Deleted files · 2'))

  expect(screen.getByRole('button', { name: 'Restore Front label (1)' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Restore Front label (2)' })).toBeVisible()
})

test('deleting more than four files shows four and says how many more', async () => {
  const user = userEvent.setup()
  const ids = Array.from({ length: 6 }, (_, index) => `e0000000-0000-4000-8000-00000000000${index}`)
  const many: MediaSnapshotDto = {
    ...present,
    evidence: ids.map((id, index) => ({
      id,
      label: `Photo ${index + 1}`,
      group_id: groupA,
      linked_subject_ids: [],
      versions: [],
    })),
  }
  renderWorkspace(mediaClient(many))
  for (let index = 1; index <= 6; index += 1) {
    await user.click(await screen.findByRole('checkbox', { name: `Select Photo ${index}` }))
  }
  await user.click(screen.getByRole('button', { name: 'Delete 6 files…' }))

  const dialog = await screen.findByRole('dialog', { name: 'Delete 6 files?' })
  expect(
    within(within(dialog).getByRole('list', { name: 'Files to delete' })).getAllByRole('listitem'),
  ).toHaveLength(4)
  expect(within(dialog).getByText('and 2 more')).toBeVisible()
})

test('Escape closes the delete dialog and returns focus to the file’s menu button', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  renderWorkspace(client)
  await chooseDelete(user, 'Front label')
  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  // jsdom doesn't turn Escape into the native dialog's cancel event, so the test sends it.
  fireEvent(dialog, new Event('cancel', { cancelable: true }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus()
  expect(client.edit).not.toHaveBeenCalled()
})

test('Delete… and Move to group… are disabled, without a reason, while a restore is sent', async () => {
  const user = userEvent.setup()
  const withDeleted: MediaSnapshotDto = {
    ...present,
    removed: [{ ...afterRemoval.removed![0], id: 'f0000000-0000-4000-8000-00000000000f' }],
  }
  const client = mediaClient(withDeleted)
  const sending = deferred<MediaSnapshotDto>()
  vi.mocked(client.edit).mockReturnValueOnce(sending.promise)
  renderWorkspace(client)
  await user.click(await screen.findByText('Deleted files · 1'))
  await user.click(screen.getByRole('button', { name: /^Restore Front label/ }))
  await user.click(screen.getByRole('button', { name: /^Actions for Back marking/ }))

  for (const name of ['Delete…', 'Move to group…']) {
    const item = await screen.findByRole('menuitem', { name })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).not.toHaveAccessibleDescription()
    await user.click(item)
  }
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByLabelText('Move selected evidence to')).toBeNull()
  await act(async () => sending.resolve(withDeleted))
})

function renderWithCache(client: MediaClient) {
  const cache = createServerQueryClient()
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
  return cache
}

test('the delete dialog refuses once the saved evidence moves past the revision it opened on', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const cache = renderWithCache(client)
  await chooseDelete(user, 'Front label')
  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  await act(async () => {
    cache.setQueryData(serverQueryKey(fixtureScope, 'media', batch.id), {
      ...present,
      revision: '5',
    })
  })

  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    'The saved evidence changed after this opened. Close it and choose Delete again.',
  )
  expect(within(dialog).getByRole('button', { name: 'Delete file' })).toBeDisabled()
})

test('the delete dialog says why it waits when the saved evidence can’t be read', async () => {
  const user = userEvent.setup()
  const client = mediaClient()
  const cache = renderWithCache(client)
  await chooseDelete(user, 'Front label')
  const dialog = await screen.findByRole('dialog', { name: 'Delete Front label?' })
  vi.mocked(client.snapshot).mockRejectedValue(new Error('offline'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'media', batch.id) })
  })

  await waitFor(() =>
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Delete waits for a fresh read of the saved evidence.',
    ),
  )
  expect(within(dialog).getByRole('button', { name: 'Delete file' })).toBeDisabled()
})

test('a present file and a deleted file that share a name are numbered together', async () => {
  const user = userEvent.setup()
  renderWorkspace(
    mediaClient({
      ...afterRemoval,
      evidence: [{ ...present.evidence[1], label: 'Front label' }],
      removed: [{ ...afterRemoval.removed![0], position: 0 }],
    }),
  )
  await user.click(await screen.findByText('Deleted files · 1'))

  expect(screen.getByRole('button', { name: 'Open Front label (2)' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Restore Front label (1)' })).toBeVisible()
})

test('deleting and restoring a file never renumbers the files that share its name', async () => {
  const user = userEvent.setup()
  const twins: MediaSnapshotDto = {
    ...present,
    evidence: present.evidence.map((item) => ({ ...item, label: 'a' })),
  }
  const deleted: MediaSnapshotDto = {
    ...twins,
    revision: '5',
    evidence: [twins.evidence[1]],
    removed: [{ ...afterRemoval.removed![0], label: 'a', position: 0 }],
  }
  const restored = { ...twins, revision: '6' }
  const client = mediaClient(twins)
  vi.mocked(client.edit).mockResolvedValueOnce(deleted).mockResolvedValueOnce(restored)
  renderWorkspace(client)
  await chooseDelete(user, 'a (1)')
  await screen.findByRole('dialog', { name: 'Delete a (1)?' })
  vi.mocked(client.snapshot).mockResolvedValue(deleted)
  await user.click(screen.getByRole('button', { name: 'Delete file' }))

  expect(await screen.findByText('Deleted a (1)')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open a (2)' })).toBeVisible()
  await user.click(screen.getByText('Deleted files · 1'))
  expect(screen.getByRole('button', { name: 'Restore a (1)' })).toBeVisible()

  vi.mocked(client.snapshot).mockResolvedValue(restored)
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('button', { name: 'Open a (1)' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open a (2)' })).toBeVisible()
})
