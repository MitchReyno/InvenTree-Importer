import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../../test/render'
import type { MediaClient } from '../../media/types'
import type { ProcessingClient } from '../../processing/types'
import { ReviewMapStage } from './ReviewMapStage'

const lot = (id: string, label: string) => ({ id, label, part_subject_id: null })

const batch = {
  id: 'b0000000-0000-4000-8000-000000000001',
  revision: '4',
  archived: false,
  lots: [lot('a', 'Packet A')],
  parts: [],
} as unknown as CaptureSnapshotDto

const snapshot = {
  batch_id: batch.id,
  revision: '9',
  groups: [],
  evidence: [
    { id: 'f1', label: 'Front label', linked_subject_ids: ['a'] },
    { id: 'f2', label: 'Stray photo', linked_subject_ids: [] },
  ],
  attachments: [],
  derivations: [],
} as unknown as MediaSnapshotDto

function media(): MediaClient {
  return {
    snapshot: vi.fn(async () => snapshot),
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(),
  }
}

describe('ReviewMapStage', () => {
  it('keeps a pending Tell Examine send through the map finishing loading', async () => {
    const user = userEvent.setup()

    let loaded: (value: MediaSnapshotDto) => void = () => {}

    let sent: (value: unknown) => void = () => {}

    const client = {
      ...media(),
      snapshot: vi.fn(() => new Promise<MediaSnapshotDto>((resolve) => (loaded = resolve))),
    }
    const chat = vi.fn(() => new Promise((resolve) => (sent = resolve)))
    const processing = {
      read: vi.fn(async () => ({
        jobs: [{ id: 'lead', stage: 'examine', subject_id: null, session_state: 'running' }],
      })),
      session: vi.fn(),
      chat,
    } as unknown as ProcessingClient
    render(
      <ReviewMapStage
        batch={batch}
        media={client}
        processing={processing}
        edit={vi.fn(async () => true)}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    const field = await screen.findByLabelText('Instruction for Examine')
    await user.type(field, 'The two reels are one lot')
    await user.click(screen.getByRole('button', { name: 'Tell Examine' }))
    loaded(snapshot)
    await screen.findByRole('heading', { name: 'How photos became lots' })
    expect(screen.getByRole('button', { name: 'Tell Examine' })).toBeDisabled()
    sent({ id: 'inbox-1' })
    await waitFor(() => expect(screen.getByLabelText('Instruction for Examine')).toHaveValue(''))
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('numbers the evidence and puts Tell Examine inside the Lots column', async () => {
    const processing = {
      read: vi.fn(async () => ({
        jobs: [{ id: 'lead', stage: 'examine', subject_id: null, session_state: 'running' }],
      })),
      session: vi.fn(),
      chat: vi.fn(),
    } as unknown as ProcessingClient
    render(
      <ReviewMapStage
        batch={batch}
        media={media()}
        processing={processing}
        edit={vi.fn(async () => true)}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    const lots = await screen.findByRole('region', { name: 'Lots' })
    expect(await within(lots).findByLabelText('Instruction for Examine')).toBeVisible()
    const files = within(screen.getByRole('region', { name: 'Evidence' })).getAllByRole('listitem')
    expect(files[0]).toHaveTextContent(/^1/)
    expect(files[1]).toHaveTextContent(/^2/)
  })

  it('links a file to a lot at the media revision it read', async () => {
    const user = userEvent.setup()
    const client = media()
    render(
      <ReviewMapStage
        batch={batch}
        media={client}
        edit={vi.fn(async () => true)}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    const stray = await screen.findByRole('listitem', { name: /Stray photo/ })
    await user.selectOptions(within(stray).getByLabelText('Link Stray photo to a lot'), 'a')
    await user.click(within(stray).getByRole('button', { name: 'Link' }))

    await waitFor(() =>
      expect(client.edit).toHaveBeenCalledWith(
        batch.id,
        {
          expected_revision: '9',
          change: { kind: 'link', evidence_id: 'f2', subject_id: 'a', linked: true },
        },
        expect.any(String),
      ),
    )
  })

  it('makes a lot from an unused file, then links the file once the lot exists', async () => {
    const user = userEvent.setup()
    const client = media()
    const edit = vi.fn(async () => true)
    const props = {
      media: client,
      edit,
      retiredLotIds: new Set<string>(),
      reload: vi.fn(async () => undefined),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={batch} {...props} />)
    await user.click(await screen.findByRole('button', { name: 'New lot from this: Stray photo' }))

    expect(edit).toHaveBeenCalledWith({
      kind: 'add_lot',
      label: 'Stray photo',
      note: 'Made from evidence “Stray photo”.',
      part_subject_id: null,
    })
    view.rerender(
      <ReviewMapStage
        batch={
          {
            ...batch,
            revision: '5',
            lots: [...batch.lots, lot('n', 'Stray photo')],
          } as unknown as CaptureSnapshotDto
        }
        {...props}
      />,
    )
    await waitFor(() =>
      expect(client.edit).toHaveBeenCalledWith(
        batch.id,
        {
          expected_revision: '9',
          change: { kind: 'link', evidence_id: 'f2', subject_id: 'n', linked: true },
        },
        expect.any(String),
      ),
    )
  })

  it('forgets a new lot that was not saved, so a later lot is never linked by mistake', async () => {
    const user = userEvent.setup()
    const client = media()
    const props = {
      media: client,
      edit: vi.fn(async () => false),
      retiredLotIds: new Set<string>(),
      reload: vi.fn(async () => undefined),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={batch} {...props} />)
    await user.click(await screen.findByRole('button', { name: 'New lot from this: Stray photo' }))
    view.rerender(
      <ReviewMapStage
        batch={
          {
            ...batch,
            revision: '5',
            lots: [...batch.lots, lot('x', 'Stray photo')],
          } as unknown as CaptureSnapshotDto
        }
        {...props}
      />,
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(client.edit).not.toHaveBeenCalled()
  })
})
