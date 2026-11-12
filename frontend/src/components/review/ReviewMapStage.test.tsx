import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { render } from '#/test/render'
import type { MediaClient } from '#/media/types'
import type { ProcessingClient } from '#/processing/types'
import { ReviewMapStage } from './ReviewMapStage'
import { ApiClientsProvider, BatchCommandsProvider } from '#/context'
import { batchCommands } from '#/test/batch-commands'

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
    removalImpact: vi.fn(),
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
      <ApiClientsProvider value={{ media: client, processing }}>
        <BatchCommandsProvider
          value={batchCommands({
            edit: vi.fn(async () => true),
            reload: vi.fn(async () => undefined),
          })}
        >
          <ReviewMapStage batch={batch} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      <ApiClientsProvider value={{ media: media(), processing }}>
        <BatchCommandsProvider
          value={batchCommands({
            edit: vi.fn(async () => true),
            reload: vi.fn(async () => undefined),
          })}
        >
          <ReviewMapStage batch={batch} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      <ApiClientsProvider value={{ media: client }}>
        <BatchCommandsProvider
          value={batchCommands({
            edit: vi.fn(async () => true),
            reload: vi.fn(async () => undefined),
          })}
        >
          <ReviewMapStage batch={batch} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
    const withLot = {
      ...batch,
      revision: '5',
      lots: [...batch.lots, lot('n', 'Stray photo')],
    } as unknown as CaptureSnapshotDto
    // Batch resolves the accepted snapshot, which holds the new lot's id.
    const edit = vi.fn(async () => withLot)
    const props = {
      retiredLotIds: new Set<string>(),
      onDirtyChange: vi.fn(),
    }
    render(<ReviewMapStage batch={batch} {...props} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: client },
    })
    await user.click(await screen.findByRole('button', { name: 'New lot from this: Stray photo' }))

    expect(edit).toHaveBeenCalledWith({
      kind: 'add_lot',
      label: 'Stray photo',
      note: 'Made from evidence “Stray photo”.',
      part_subject_id: null,
    })
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
    expect(client.edit).toHaveBeenCalledOnce()
  })

  it('sends no link when the new lot was not saved', async () => {
    const user = userEvent.setup()
    const client = media()
    const edit = vi.fn(async () => false as const)
    render(<ReviewMapStage batch={batch} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: client },
    })
    await user.click(await screen.findByRole('button', { name: 'New lot from this: Stray photo' }))
    await waitFor(() => expect(edit).toHaveBeenCalledOnce())
    expect(client.edit).not.toHaveBeenCalled()
  })

  it('says the file still needs linking when the save does not return the new lot', async () => {
    const user = userEvent.setup()
    const client = media()
    const edit = vi.fn(async () => true)
    render(<ReviewMapStage batch={batch} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: client },
    })
    await user.click(await screen.findByRole('button', { name: 'New lot from this: Stray photo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The lot was made, but its file was not linked. Link it from the Map.',
    )
    expect(client.edit).not.toHaveBeenCalled()
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
    const view = render(
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({ edit, reload: vi.fn(async () => undefined) })}
        >
          <ReviewMapStage batch={regioned} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
    )
    await user.selectOptions(await screen.findByLabelText('Move 1N4148 to'), 'b')
    await user.click(screen.getByRole('button', { name: 'Move 1N4148' }))
    expect(edit).toHaveBeenCalledWith(
      {
        kind: 'observation_move',
        observation_id: 'o1',
        lot_id: 'b',
      },
      undefined,
    )
    // Once refreshed into Packet B, B is no longer a destination, so Move cannot send it again.
    const moved = {
      ...regioned,
      revision: '5',
      evidence_observations: regioned.evidence_observations!.map((item) =>
        item.id === 'o1' ? { ...item, lot_id: 'b' } : item,
      ),
    } as CaptureSnapshotDto
    view.rerender(
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({ edit, reload: vi.fn(async () => undefined) })}
        >
          <ReviewMapStage batch={moved} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
    )
    expect(screen.getByLabelText('Move 1N4148 to')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Move 1N4148' })).toBeDisabled()
  })

  it('marks a region as the same item as another of its lot, counts it once and clears the mark', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    const first = regioned.evidence_observations![0]
    const twoViews = {
      ...regioned,
      evidence_observations: [
        { ...first, visible_count: 200 },
        {
          ...first,
          id: 'o2',
          readings: { markings: ['Bag again'], text: null },
          visible_count: 200,
        },
        { ...first, id: 'o3', readings: { markings: ['Other'], text: null }, lot_id: 'b' },
      ],
    } as unknown as CaptureSnapshotDto
    const props = {
      retiredLotIds: new Set<string>(),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={twoViews} {...props} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: versioned() },
    })
    const packetA = await screen.findByRole('listitem', { name: 'Packet A' })
    expect(packetA).toHaveTextContent('400 counted')

    const choice = screen.getByLabelText('Bag again is the same item as')
    // Only regions of the same lot are offered.
    expect(within(choice).queryByRole('option', { name: /Other/ })).toBeNull()
    await user.selectOptions(choice, 'o1')
    await user.click(screen.getByRole('button', { name: 'Mark Bag again as the same item' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'observation_same_item',
      observation_id: 'o2',
      same_as: 'o1',
    })

    const marked = {
      ...twoViews,
      revision: '5',
      evidence_observations: twoViews.evidence_observations!.map((item) =>
        item.id === 'o2' ? { ...item, same_item_as: 'o1' } : item,
      ),
    } as CaptureSnapshotDto
    view.rerender(<ReviewMapStage batch={marked} {...props} />)
    expect(screen.getByRole('listitem', { name: 'Packet A' })).toHaveTextContent(
      '200 counted · 1 seen twice',
    )
    expect(screen.getByRole('list', { name: /Regions of/ })).toHaveTextContent(
      'Bag again · same item as 1N4148',
    )
    await user.click(screen.getByRole('button', { name: 'Bag again is not the same item' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'observation_same_item',
      observation_id: 'o2',
      same_as: null,
    })
  })

  it('makes a lot from a region, then moves the region into it', async () => {
    const user = userEvent.setup()
    const withLot = { ...regioned, revision: '5', lots: [...regioned.lots, lot('n', '1N4148')] }
    const edit = vi.fn(async () => withLot as never)
    const props = {
      retiredLotIds: new Set<string>(),
      onDirtyChange: vi.fn(),
    }
    render(<ReviewMapStage batch={regioned} {...props} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: versioned() },
    })
    await user.click(await screen.findByRole('button', { name: 'New lot from region: 1N4148' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'add_lot',
      label: '1N4148',
      note: 'Made from region “1N4148”.',
      part_subject_id: null,
    })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'observation_move',
          observation_id: 'o1',
          lot_id: 'n',
        },
        // The move follows the new lot's save, so it names that save's revision.
        '5',
      ),
    )
  })

  it('offers to finish moving the region when the new lot was made but the move was not', async () => {
    const user = userEvent.setup()
    const withLot = { ...regioned, revision: '5', lots: [...regioned.lots, lot('n', '1N4148')] }
    const edit = vi.fn(async (change: { kind: string }) =>
      change.kind === 'observation_move' ? false : (withLot as never),
    )
    const props = {
      retiredLotIds: new Set<string>(),
      onDirtyChange: vi.fn(),
    }
    render(<ReviewMapStage batch={regioned} {...props} />, {
      commands: { edit, reload: vi.fn(async () => undefined) },
      clients: { media: versioned() },
    })
    await user.click(await screen.findByRole('button', { name: 'New lot from region: 1N4148' }))
    const finish = await screen.findByRole('button', { name: 'Move 1N4148 into lot 1N4148' })
    edit.mockImplementation(async () => true as never)
    await user.click(finish)
    expect(edit).toHaveBeenLastCalledWith(
      {
        kind: 'observation_move',
        observation_id: 'o1',
        lot_id: 'n',
      },
      undefined,
    )
    expect(edit.mock.calls.filter(([change]) => change.kind === 'add_lot')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Move 1N4148 into lot 1N4148' })).toBeNull(),
    )
  })

  it('adjusts a region on the selected photo through the observation edit', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    render(
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({ edit, reload: vi.fn(async () => undefined) })}
        >
          <ReviewMapStage batch={regioned} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({ edit, reload: vi.fn(async () => undefined) })}
        >
          <ReviewMapStage
            batch={regioned}
            retiredLotIds={new Set()}
            onDirtyChange={onDirtyChange}
          />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      retiredLotIds: new Set<string>(),
      onDirtyChange,
    }
    const view = render(<ReviewMapStage {...props} discarded={0} />, {
      commands: { edit: vi.fn(async () => false), reload: vi.fn(async () => undefined) },
      clients: { media: versioned() },
    })
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
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({
            edit: vi.fn(async () => true),
            reload: vi.fn(async () => undefined),
          })}
        >
          <ReviewMapStage batch={twoPages} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      <ApiClientsProvider value={{ media: versioned() }}>
        <BatchCommandsProvider
          value={batchCommands({ edit, reload: vi.fn(async () => undefined) })}
        >
          <ReviewMapStage batch={regioned} retiredLotIds={new Set()} onDirtyChange={vi.fn()} />
        </BatchCommandsProvider>
      </ApiClientsProvider>,
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
      retiredLotIds: new Set<string>(),
      onDirtyChange: vi.fn(),
    }
    const view = render(<ReviewMapStage batch={batch} {...props} />, {
      commands: { edit: vi.fn(async () => false), reload: vi.fn(async () => undefined) },
      clients: { media: client },
    })
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
