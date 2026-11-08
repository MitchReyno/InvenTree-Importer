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

  const regioned = {
    ...batch,
    lots: [lot('a', 'Packet A'), lot('b', 'Packet B')],
    evidence_observations: [
      {
        id: 'o1',
        evidence_version_id: 'v1',
        page: null,
        region: {
          kind: 'pixels',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          source_width: 9,
          source_height: 9,
        },
        readings: { markings: ['1N4148'], text: null },
        visible_count: null,
        status: 'active',
        lot_id: 'a',
      },
    ],
  } as unknown as CaptureSnapshotDto

  const versioned = () => ({
    ...media(),
    snapshot: vi.fn(
      async () =>
        ({
          ...snapshot,
          evidence: snapshot.evidence.map((item) =>
            item.id === 'f1'
              ? {
                  ...item,
                  versions: [
                    {
                      id: 'v1',
                      evidence_id: 'f1',
                      kind: 'original',
                      state: 'ready',
                      pages: [
                        {
                          page: 1,
                          width: 900,
                          height: 600,
                          preview_id: 'd0000000-0000-4000-8000-000000000001',
                        },
                      ],
                    },
                  ],
                }
              : item,
          ),
        }) as unknown as MediaSnapshotDto,
    ),
  })

  it('moves a region to another lot', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    render(
      <ReviewMapStage
        batch={regioned}
        media={versioned()}
        edit={edit}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    await user.selectOptions(await screen.findByLabelText('Move 1N4148 to'), 'b')
    await user.click(screen.getByRole('button', { name: 'Move 1N4148' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'observation_move',
      observation_id: 'o1',
      lot_id: 'b',
    })
  })

  it('makes a lot from a region, then moves the region into it', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    const props = {
      media: versioned(),
      edit,
      retiredLotIds: new Set<string>(),
      reload: vi.fn(async () => undefined),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={regioned} {...props} />)
    await user.click(await screen.findByRole('button', { name: 'New lot from region: 1N4148' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'add_lot',
      label: '1N4148',
      note: 'Made from region “1N4148”.',
      part_subject_id: null,
    })
    view.rerender(
      <ReviewMapStage
        batch={
          { ...regioned, revision: '5', lots: [...regioned.lots, lot('n', '1N4148')] } as never
        }
        {...props}
      />,
    )
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        kind: 'observation_move',
        observation_id: 'o1',
        lot_id: 'n',
      }),
    )
  })

  it('offers to finish moving the region when the new lot was made but the move was not', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async (change: { kind: string }) => change.kind !== 'observation_move')
    const props = {
      media: versioned(),
      edit,
      retiredLotIds: new Set<string>(),
      reload: vi.fn(async () => undefined),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={regioned} {...props} />)
    await user.click(await screen.findByRole('button', { name: 'New lot from region: 1N4148' }))
    view.rerender(
      <ReviewMapStage
        batch={
          { ...regioned, revision: '5', lots: [...regioned.lots, lot('n', '1N4148')] } as never
        }
        {...props}
      />,
    )
    const finish = await screen.findByRole('button', { name: 'Move 1N4148 into lot 1N4148' })
    edit.mockImplementation(async () => true)
    await user.click(finish)
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'observation_move',
      observation_id: 'o1',
      lot_id: 'n',
    })
    expect(edit.mock.calls.filter(([change]) => change.kind === 'add_lot')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Move 1N4148 into lot 1N4148' })).toBeNull(),
    )
  })

  it('adjusts a region on the selected photo through the observation edit', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    render(
      <ReviewMapStage
        batch={regioned}
        media={versioned()}
        edit={edit}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Show links for Front label' }))
    const stage = screen.getByRole('region', { name: 'Regions of Front label' })
    await user.click(within(stage).getByRole('button', { name: 'Adjust 1N4148' }))
    const x = within(stage).getByLabelText('Left')
    await user.clear(x)
    await user.type(x, '3')
    await user.click(within(stage).getByRole('button', { name: 'Save region' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'observation',
      observation_id: 'o1',
      evidence_version_id: 'v1',
      page: 1,
      region: {
        kind: 'pixels',
        x: 3,
        y: 0,
        width: 1,
        height: 1,
        source_width: 9,
        source_height: 9,
      },
    })
  })

  it('keeps a region draft when its save is not confirmed', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => false)
    const onDirtyChange = vi.fn()
    render(
      <ReviewMapStage
        batch={regioned}
        media={versioned()}
        edit={edit}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={onDirtyChange}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Show links for Front label' }))
    const stage = screen.getByRole('region', { name: 'Regions of Front label' })
    await user.click(within(stage).getByRole('button', { name: 'Adjust 1N4148' }))
    const x = within(stage).getByLabelText('Left')
    await user.clear(x)
    await user.type(x, '3')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    // Another region or file cannot replace the unsaved draft.
    expect(within(stage).getByRole('button', { name: 'Add a region' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show links for Front label' })).toBeDisabled()
    await user.click(within(stage).getByRole('button', { name: 'Save region' }))
    expect(edit).toHaveBeenCalledTimes(1)
    expect(within(stage).getByLabelText('Left')).toHaveValue(3)
  })

  it('drops a region draft when the batch’s local edits are discarded', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    const props = {
      batch: regioned,
      media: versioned(),
      edit: vi.fn(async () => false),
      retiredLotIds: new Set<string>(),
      reload: vi.fn(async () => undefined),
      onDirtyChange,
    }
    const view = render(<ReviewMapStage {...props} discarded={0} />)
    await user.click(await screen.findByRole('button', { name: 'Show links for Front label' }))

    const stage = () => screen.getByRole('region', { name: 'Regions of Front label' })

    await user.click(within(stage()).getByRole('button', { name: 'Adjust 1N4148' }))
    expect(within(stage()).getByLabelText('Left')).toBeInTheDocument()
    view.rerender(<ReviewMapStage {...props} discarded={1} />)
    expect(within(stage()).queryByLabelText('Left')).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('shows only the displayed page’s regions', async () => {
    const user = userEvent.setup()
    const twoPages = {
      ...regioned,
      evidence_observations: [
        ...regioned.evidence_observations!,
        {
          ...regioned.evidence_observations![0],
          id: 'o2',
          page: 2,
          readings: { markings: ['LM358'], text: null },
        },
      ],
    } as unknown as CaptureSnapshotDto
    render(
      <ReviewMapStage
        batch={twoPages}
        media={versioned()}
        edit={vi.fn(async () => true)}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Show links for Front label' }))
    const stage = screen.getByRole('region', { name: 'Regions of Front label' })
    expect(within(stage).getByRole('button', { name: 'Adjust 1N4148' })).toBeInTheDocument()
    expect(within(stage).queryByRole('button', { name: 'Adjust LM358' })).toBeNull()
  })

  it('adds a region to the selected photo', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    render(
      <ReviewMapStage
        batch={regioned}
        media={versioned()}
        edit={edit}
        retiredLotIds={new Set()}
        reload={vi.fn(async () => undefined)}
        onDirtyChange={vi.fn()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Show links for Front label' }))
    const stage = screen.getByRole('region', { name: 'Regions of Front label' })
    await user.click(within(stage).getByRole('button', { name: 'Add a region' }))
    await user.click(within(stage).getByRole('button', { name: 'Save region' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'observation',
      evidence_version_id: 'v1',
      page: 1,
      region: {
        kind: 'pixels',
        x: 225,
        y: 150,
        width: 450,
        height: 300,
        source_width: 900,
        source_height: 600,
      },
    })
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
