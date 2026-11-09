import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '#/media/types'
import { useDirtySources } from '#/operator/useDirtySources'
import { render } from '#/test/render'
import { ReviewSubjectEditor } from './ReviewSubjectEditor'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'
import { BatchCommandsProvider } from '#/components/batches/BatchCommandsProvider'
import { batchCommands } from '#/test/batch-commands'

const lotId = '30000000-0000-4000-8000-000000000003'
const evidenceId = '60000000-0000-4000-8000-000000000006'
const versionId = '80000000-0000-4000-8000-000000000008'
const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '50000000-0000-4000-8000-000000000005',
  target_context_id: '60000000-0000-4000-8000-000000000006',
  title: 'Attachment fence',
  revision: '4',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  lots: [
    {
      id: lotId,
      label: 'Packet A',
      revision: '1',
      contribution_key: '70000000-0000-4000-8000-000000000007',
      part_subject_id: null,
      quantity: { mode: 'set', value: '3' },
      location: { mode: 'inherit' },
    },
  ],
  observations: [],
  notes: [],
  cursor: { stream_id: '90000000-0000-4000-8000-000000000009', sequence: '0' },
}
const media: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '4',
  evidence: [
    {
      id: evidenceId,
      label: 'packet.png',
      group_id: null,
      linked_subject_ids: [],
      versions: [
        {
          id: versionId,
          evidence_id: evidenceId,
          kind: 'original',
          digest: 'a'.repeat(64),
          byte_size: '4',
          media_type: 'image/png',
          state: 'ready',
          decoder_build: null,
          recipe: null,
          pages: [],
        },
      ],
    },
  ],
  attachments: [],
  groups: [],
  derivations: [],
} as unknown as MediaSnapshotDto

function Harness({ client, reload }: { client: MediaClient; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(true)
  const drafts = useDirtySources()
  return open ? (
    <ApiClientsProvider value={{ media: client }}>
      <BatchCommandsProvider value={batchCommands({ observe: vi.fn(async () => null), reload })}>
        <ReviewSubjectEditor
          batch={batch}
          subjectId={lotId}
          subjectDisabled={drafts.hasOtherSources('subject')}
          attachmentDisabled={drafts.hasOtherSources('attachment')}
          dirty={drafts.dirty}
          edit={vi.fn(async () => true)}
          onDirtyChange={drafts.forSource('subject')}
          onAttachmentDirtyChange={drafts.forSource('attachment')}
          onClose={() => setOpen(false)}
          retainRoute={vi.fn()}
        />
      </BatchCommandsProvider>
    </ApiClientsProvider>
  ) : (
    <p>Editor closed</p>
  )
}

test('an uncertain attachment change blocks closing and offers only exact retry or discard', async () => {
  const user = userEvent.setup()
  const client: MediaClient = {
    snapshot: vi.fn(async () => media),
    edit: vi.fn(async () => {
      throw new TypeError('acknowledgement_lost')
    }),
    upload: vi.fn(),
  }
  const reload = vi.fn(async () => undefined)
  render(<Harness client={client} reload={reload} />)
  const choice = await screen.findByLabelText('Attachment for Packet A')
  await waitFor(() => expect(choice).toBeEnabled())
  await user.selectOptions(choice, versionId)
  await screen.findByRole('button', { name: 'Retry exact attachment change' })
  expect(
    screen.getByRole('button', { name: /Close editor · save or discard first/ }),
  ).toBeDisabled()
  expect(reload).not.toHaveBeenCalled()
  vi.mocked(client.edit).mockResolvedValue({ ...media, revision: '5' })
  await user.click(screen.getByRole('button', { name: 'Retry exact attachment change' }))
  await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(vi.mocked(client.edit).mock.calls[1]).toEqual(vi.mocked(client.edit).mock.calls[0])
  expect(screen.getByRole('button', { name: 'Close editor' })).toBeEnabled()
})

test('a subject draft and an attachment change fence each other', async () => {
  const user = userEvent.setup()
  const client: MediaClient = {
    snapshot: vi.fn(async () => media),
    edit: vi.fn(async () => {
      throw new TypeError('acknowledgement_lost')
    }),
    upload: vi.fn(),
  }
  const reload = vi.fn(async () => undefined)
  render(<Harness client={client} reload={reload} />)
  const choice = await screen.findByLabelText('Attachment for Packet A')
  await waitFor(() => expect(choice).toBeEnabled())
  const label = screen.getByLabelText('Lot label')
  await user.type(label, ' renamed')
  expect(choice).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard unsaved input' }))
  await waitFor(() => expect(choice).toBeEnabled())
  await user.selectOptions(choice, versionId)
  await screen.findByRole('button', { name: 'Retry exact attachment change' })
  expect(label).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Discard unconfirmed attachment change' }),
  ).toBeEnabled()
})

test('a confirmed attachment change keeps the subject form fenced until the reload finishes', async () => {
  const user = userEvent.setup()

  let finishRead = () => undefined as void

  const snapshot = vi
    .fn<MediaClient['snapshot']>()
    .mockResolvedValueOnce(media)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ ...media, revision: '5' })
        }),
    )
  const client: MediaClient = {
    snapshot,
    edit: vi.fn(async () => ({ ...media, revision: '5' })),
    upload: vi.fn(),
  }

  let finishReload = () => undefined as void

  const reload = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)))
  render(<Harness client={client} reload={reload} />)
  const choice = await screen.findByLabelText('Attachment for Packet A')
  await waitFor(() => expect(choice).toBeEnabled())
  await user.selectOptions(choice, versionId)
  await waitFor(() => expect(client.edit).toHaveBeenCalledOnce())
  expect(screen.getByLabelText('Lot label')).toBeDisabled()
  finishRead()
  await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(screen.getByLabelText('Lot label')).toBeDisabled()
  finishReload()
  await waitFor(() => expect(screen.getByLabelText('Lot label')).toBeEnabled())
})
