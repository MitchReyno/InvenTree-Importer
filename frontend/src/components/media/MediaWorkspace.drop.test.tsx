import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type {
  CaptureSnapshotDto,
  MediaReceiptDto,
  MediaSnapshotDto,
  MediaVersionDto,
} from '@invimport/contracts'
import { fixtureScope, render } from '#/test/render'
import type { MediaClient } from '#/media/types'
import { MediaWorkspace } from './MediaWorkspace'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Dropped packets',
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
const packets = '40000000-0000-4000-8000-000000000004'
const front = '60000000-0000-4000-8000-000000000006'
const initial: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  groups: [{ id: packets, label: 'Resistor packets' }],
  evidence: [
    { id: front, label: 'Front label', group_id: packets, linked_subject_ids: [], versions: [] },
  ],
  attachments: [],
  derivations: [],
}

type Gate = { release: () => void }

/**
 * An in-memory media store: each upload is kept ungrouped and each move applies, as the server
 * does. Uploads after the first wait for `gate.release` so progress can be read mid-run.
 */
function mediaStore() {
  let current = initial
  const gate: Gate = { release: () => undefined }
  const client: MediaClient = {
    removalImpact: vi.fn(),
    snapshot: vi.fn(async () => current),
    edit: vi.fn(async (_batch, input) => {
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
    }),
    upload: vi.fn(async (_batch, _revision, label, bytes): Promise<MediaReceiptDto> => {
      const count = vi.mocked(client.upload).mock.calls.length
      if (count === 2) {
        await new Promise<void>((resolve) => (gate.release = resolve))
      }
      const id = `9000000${count}-0000-4000-8000-000000000009`
      const version: MediaVersionDto = {
        id: `a000000${count}-0000-4000-8000-00000000000a`,
        evidence_id: id,
        kind: 'original',
        digest: 'b'.repeat(64),
        byte_size: '4',
        media_type: (bytes as File).type === 'application/pdf' ? 'application/pdf' : 'image/png',
        state: 'queued',
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
    }),
  }
  return { client, gate }
}

function jpeg(name: string) {
  return new File(['jpeg'], name, { type: 'image/jpeg' })
}

function png(name: string) {
  return new File(['png'], name, { type: 'image/png' })
}

function pdf(name: string) {
  return new File(['pdf'], name, { type: 'application/pdf' })
}

function fileDrag(files: File[]) {
  return { dataTransfer: { files, types: ['Files'], dropEffect: 'none' } }
}

function dropOn(target: Element, files: File[]) {
  fireEvent.dragEnter(target, fileDrag(files))
  fireEvent.dragOver(target, fileDrag(files))
  fireEvent.drop(target, fileDrag(files))
}

function pasteInto(target: Element, files: File[]) {
  return fireEvent.paste(target, { clipboardData: { files, types: ['Files'] } })
}

function renderWorkspace(
  client: MediaClient,
  { disabled = false, archived = false }: { disabled?: boolean; archived?: boolean } = {},
) {
  return render(
    <MediaWorkspace
      batch={{ ...batch, archived }}
      client={client}
      disabled={disabled}
      selectedSubject="defaults"
      onDirtyChange={vi.fn()}
    />,
  )
}

async function editable() {
  const group = await screen.findByRole('region', { name: /Resistor packets/ })
  await waitFor(() =>
    expect(
      within(group).getByRole('button', { name: 'Add photos to Resistor packets' }),
    ).toBeEnabled(),
  )
  return group
}

test('three photos and a PDF dropped on a group upload into it as one run of four', async () => {
  const { client, gate } = mediaStore()
  renderWorkspace(client)
  const group = await editable()
  const panel = screen.getByRole('region', { name: 'Retained evidence' })

  fireEvent.dragEnter(group, fileDrag([jpeg('a.jpg')]))
  expect(group).toHaveAttribute('data-drop', 'over')
  // The group shows where the files go; the panel around it does not also claim them.
  expect(panel).not.toHaveAttribute('data-drop', 'over')
  fireEvent.dragLeave(group, fileDrag([jpeg('a.jpg')]))
  expect(group).not.toHaveAttribute('data-drop', 'over')

  dropOn(group, [jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg'), pdf('receipt.pdf')])

  await waitFor(() => expect(within(group).getByText(/Uploading 2 of 4/)).toBeVisible())
  expect(group).not.toHaveAttribute('data-drop', 'over')
  await act(async () => gate.release())
  await waitFor(() =>
    expect(within(group).getByRole('checkbox', { name: 'Select receipt.pdf' })).toBeVisible(),
  )
  expect(vi.mocked(client.upload).mock.calls.map((call) => call[2])).toEqual([
    'a.jpg',
    'b.jpg',
    'c.jpg',
    'receipt.pdf',
  ])
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) {
    expect(within(group).getByRole('checkbox', { name: `Select ${name}` })).toBeVisible()
  }
})

test('an unsupported file in a drop shows Not added while the photos upload', async () => {
  const { client, gate } = mediaStore()
  gate.release()
  renderWorkspace(client)
  const group = await editable()

  dropOn(group, [jpeg('a.jpg'), new File(['zip'], 'parts.zip', { type: 'application/zip' })])

  const refused = await within(group).findByRole('group', { name: 'Upload of parts.zip' })
  expect(within(refused).getByRole('alert')).toHaveTextContent(/Not added.*JPEG or PNG/)
  await waitFor(() =>
    expect(within(group).getByRole('checkbox', { name: 'Select a.jpg' })).toBeVisible(),
  )
  expect(client.upload).toHaveBeenCalledOnce()
})

test('files dropped on the panel outside a group go to Ungrouped', async () => {
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  const panel = screen.getByRole('region', { name: 'Retained evidence' })
  const actions = screen.getByRole('button', { name: 'Take photos' })

  fireEvent.dragEnter(actions, fileDrag([png('shot.png')]))
  expect(panel).toHaveAttribute('data-drop', 'over')
  dropOn(actions, [png('shot.png')])

  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  await waitFor(() =>
    expect(within(ungrouped).getByRole('checkbox', { name: 'Select shot.png' })).toBeVisible(),
  )
  expect(client.upload).toHaveBeenCalledOnce()
  expect(client.edit).not.toHaveBeenCalled()
  expect(panel).not.toHaveAttribute('data-drop', 'over')
})

test('a drop on a group inside the panel is taken once, by the group', async () => {
  const { client, gate } = mediaStore()
  gate.release()
  renderWorkspace(client)
  const group = await editable()

  dropOn(within(group).getByRole('checkbox', { name: 'Select Front label' }), [png('one.png')])

  await waitFor(() =>
    expect(within(group).getByRole('checkbox', { name: 'Select one.png' })).toBeVisible(),
  )
  expect(client.upload).toHaveBeenCalledOnce()
})

test('a pasted image outside text fields goes to Ungrouped', async () => {
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()

  const event = pasteInto(document.body, [png('screenshot.png')])

  expect(event).toBe(false)
  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  await waitFor(() =>
    expect(
      within(ungrouped).getByRole('checkbox', { name: 'Select screenshot.png' }),
    ).toBeVisible(),
  )
})

test('pasting inside a note leaves the paste to the note', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('button', { name: 'Open Front label' }))
  await user.click(await screen.findByRole('button', { name: 'Edit note for Front label' }))
  const note = screen.getByRole('textbox', { name: 'Note for Front label' })

  const event = pasteInto(note, [png('screenshot.png')])

  expect(event).toBe(true)
  expect(client.upload).not.toHaveBeenCalled()
  expect(screen.queryByRole('group', { name: 'Upload of screenshot.png' })).toBeNull()
})

test('a paste while a file is open in its viewer stays out of the evidence', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('button', { name: 'Open Front label' }))
  const viewer = await screen.findByRole('dialog', { name: 'Front label' })

  pasteInto(within(viewer).getByRole('button', { name: 'Close' }), [png('screenshot.png')])

  await act(async () => undefined)
  expect(client.upload).not.toHaveBeenCalled()
})

test('a pasted file of an unsupported type shows Not added', async () => {
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()

  pasteInto(document.body, [new File(['gif'], 'clip.gif', { type: 'image/gif' })])

  const ungrouped = screen.getByRole('region', { name: /Ungrouped/ })
  const refused = await within(ungrouped).findByRole('group', { name: 'Upload of clip.gif' })
  expect(within(refused).getByRole('alert')).toHaveTextContent(/Not added.*JPEG or PNG/)
  expect(client.upload).not.toHaveBeenCalled()
})

test('a file dropped inside an open viewer stays out of the evidence behind it', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('button', { name: 'Open Front label' }))
  const viewer = await screen.findByRole('dialog', { name: 'Front label' })

  dropOn(within(viewer).getByRole('button', { name: 'Close' }), [png('inside.png')])

  await act(async () => undefined)
  expect(client.upload).not.toHaveBeenCalled()
  expect(screen.queryByRole('group', { name: 'Upload of inside.png' })).toBeNull()
})

test('pasted text outside a text field is ignored', async () => {
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()

  const event = pasteInto(document.body, [])

  expect(event).toBe(true)
  expect(client.upload).not.toHaveBeenCalled()
  expect(screen.queryByRole('status', { name: /not added/i })).toBeNull()
})

async function expectRefused(reason: RegExp, client: MediaClient) {
  const user = userEvent.setup()
  const panel = screen.getByRole('region', { name: 'Retained evidence' })
  const group = screen.queryByRole('region', { name: /Resistor packets/ })
  fireEvent.dragEnter(group ?? panel, fileDrag([png('drop.png')]))
  expect(group ?? panel).not.toHaveAttribute('data-drop', 'over')
  dropOn(group ?? panel, [png('drop.png')])
  expect(await screen.findByText(reason)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByText(reason)).toBeNull()

  // A paste is refused on its own, with the same reason.
  pasteInto(document.body, [png('paste.png')])
  expect(await screen.findByText(reason)).toBeVisible()
  expect(client.upload).not.toHaveBeenCalled()
  expect(screen.queryByRole('group', { name: /^Upload of/ })).toBeNull()
}

test('drop and paste are refused while media is disabled', async () => {
  const { client } = mediaStore()
  renderWorkspace(client, { disabled: true })
  await screen.findByRole('region', { name: /Resistor packets/ })
  await expectRefused(/other Capture changes/, client)
})

test('drop and paste are refused while the batch is archived', async () => {
  const { client } = mediaStore()
  renderWorkspace(client, { disabled: true, archived: true })
  await screen.findByRole('region', { name: /Resistor packets/ })
  await expectRefused(/Resume the batch to add files/, client)
})

test('drop and paste are refused until the saved evidence has been read', async () => {
  const { client } = mediaStore()
  vi.mocked(client.snapshot).mockRejectedValue(new Error('offline'))
  renderWorkspace(client)
  await waitFor(() => expect(client.snapshot).toHaveBeenCalled())
  await expectRefused(/fresh read of the saved evidence/, client)
})

test('drop and paste are refused while an evidence change is unconfirmed', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  vi.mocked(client.edit).mockRejectedValue(new Error('lost'))
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await screen.findByRole('button', { name: 'Retry exact media request' })
  await expectRefused(/retried or discarded/, client)
})

test('drop and paste are refused while an evidence change is being sent', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  vi.mocked(client.edit).mockReturnValue(new Promise(() => undefined))
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('checkbox', { name: 'Select Front label' }))
  await user.click(screen.getByRole('button', { name: 'Move selected evidence' }))
  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  await expectRefused(/evidence change being sent/, client)
})

test('drop and paste are refused while another evidence draft is open', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('button', { name: 'New group' }))
  await user.type(screen.getByLabelText('New group name'), 'Capacitors')
  await expectRefused(/other evidence changes/, client)
})

test('a refusal notice clears once files are accepted again', async () => {
  const user = userEvent.setup()
  const { client } = mediaStore()
  renderWorkspace(client)
  await editable()
  await user.click(screen.getByRole('button', { name: 'New group' }))
  await user.type(screen.getByLabelText('New group name'), 'Capacitors')
  pasteInto(document.body, [png('early.png')])
  expect(await screen.findByText(/other evidence changes/)).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Discard new group name edits' }))
  await waitFor(() => expect(screen.queryByLabelText('New group name')).toBeNull())
  pasteInto(document.body, [png('later.png')])

  await waitFor(() => expect(client.upload).toHaveBeenCalledOnce())
  expect(screen.queryByText(/other evidence changes/)).toBeNull()
})
