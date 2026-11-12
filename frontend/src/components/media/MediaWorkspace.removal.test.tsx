import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { fixtureScope, render } from '#/test/render'
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

function renderWorkspace(client: MediaClient, workspaceBatch = batch, disabled = false) {
  render(
    <MediaWorkspace
      batch={workspaceBatch}
      client={client}
      disabled={disabled}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
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
  expect(within(dialog).getByText(/Loose reel will have no other evidence/)).toBeVisible()
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
    await within(dialog).findByText(/Packet A and Loose reel will have no other evidence/),
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
