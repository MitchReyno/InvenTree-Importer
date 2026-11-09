import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  CaptureSnapshotDto,
  ManualPreviewDto,
  ManualWorkspaceDto,
  PreparationNodeDto,
  PreparationTreeDto,
} from '@invimport/contracts'
import { render } from '#/test/render'
import { ReadyToAdd } from './ReadyToAdd'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const lots = [1, 2, 3].map((n) => id(100 + n))
const batch = {
  id: id(1),
  archived: false,
  defaults: {
    quantity: { mode: 'unknown' },
    location: {
      mode: 'set',
      value: { observation_id: id(900), target_context_id: id(901), model: 'location', pk: '43' },
    },
  },
  lots: lots.map((lot, index) => ({ id: lot, label: `Packet ${'ABC'[index]}` })),
} as unknown as CaptureSnapshotDto

/** Packet C goes to Bench bin B3; the others go to the batch default, Bin 43. */
function preview(selected: string[], n = 50): ManualPreviewDto {
  return {
    id: id(n),
    batch_id: batch.id,
    selected_lot_ids: selected,
    remaining_lot_ids: lots.filter((lot) => !selected.includes(lot)),
    plan_sha256: 'a'.repeat(64),
    review_fingerprint: 'b'.repeat(64),
    target_revision: '1',
    capability: 'owned-fake-effects/2',
    effects: selected.map((lot) => ({
      lot_id: lot,
      lot_label: batch.lots.find((value) => value.id === lot)!.label,
      part_label: 'Existing resistor',
      quantity: '10',
      location_id: lot === lots[2] ? '44' : '43',
      location_label: lot === lots[2] ? 'Bench bin B3' : 'Bin 43',
      contribution_key: id(200),
      barcode: 'bi1:x:y',
      part_id: '29',
    })),
  } as unknown as ManualPreviewDto
}

function workspace(preparations: ManualPreviewDto[]): ManualWorkspaceDto {
  return {
    lots: lots.map((lot) => ({ lot_id: lot, reviewed: true, issues: [] })),
    preparations,
  } as unknown as ManualWorkspaceDto
}

const node = (value: Partial<PreparationNodeDto> & Pick<PreparationNodeDto, 'key' | 'kind'>) =>
  ({
    label: value.key,
    state: 'new',
    parent_key: null,
    location_key: null,
    lot_id: null,
    part_subject_id: null,
    detail: null,
    ...value,
  }) as PreparationNodeDto

const treeNodes = [
  node({ key: 'category:81', kind: 'category', label: 'Resistors', state: 'exists' }),
  node({
    key: 'part:p',
    kind: 'part',
    label: 'New resistor',
    parent_key: 'category:81',
    detail: 'Through-hole · Tags: SMD',
  }),
  node({
    key: 'parameter:p',
    kind: 'parameter',
    label: 'Resistance: 4.7 kΩ',
    parent_key: 'part:p',
  }),
  node({
    key: 'supplier_part:p',
    kind: 'supplier_part',
    label: 'S-47 · DigiKey',
    parent_key: 'part:p',
    state: 'update',
  }),
  node({
    key: `stock:${lots[0]}`,
    kind: 'stock_item',
    label: 'Packet A · 10',
    parent_key: 'part:p',
    lot_id: lots[0],
  }),
]

function setup(
  options: {
    shown?: ManualPreviewDto | null
    current?: ManualPreviewDto[]
    tree?: PreparationNodeDto[] | null
  } = {},
) {
  const shown = options.shown === undefined ? preview(lots) : options.shown
  const prepareLots = vi.fn()
  const approve = vi.fn()
  const readTree = vi.fn(async (preparationId: string): Promise<PreparationTreeDto> => ({
    preparation_id: preparationId,
    plan_version: 'bench-effects-plan/2',
    nodes: options.tree === undefined ? treeNodes : options.tree,
  }))
  const props = {
    batch,
    workspace: workspace(options.current ?? (shown ? [shown] : [])),
    preview: shown,
    pinnedPreparationId: shown?.id,
    busy: false,
    choose: vi.fn(),
    prepareLots,
    approve,
    readTree,
  }
  const view = render(<ReadyToAdd {...props} />)
  return { ...view, props, prepareLots, approve }
}

describe('ReadyToAdd', () => {
  it('lists each lot as a row with its thumbnail and what it adds', () => {
    setup()
    const row = screen.getByRole('checkbox', { name: 'Packet B' }).closest('label')!
    expect(row.querySelector('[data-thumb]')).not.toBeNull()
    expect(row).toHaveTextContent('10 pcs')
    expect(screen.getByRole('region', { name: 'Lots to include' }).parentElement).toHaveAttribute(
      'data-columns',
      'two',
    )
  })

  it('names a lot’s location only when it differs from the batch default', () => {
    setup()

    const row = (name: string) => screen.getByRole('checkbox', { name }).closest('label')!

    expect(row('Packet A')).not.toHaveTextContent('Bin 43')
    expect(row('Packet B')).not.toHaveTextContent('Bin 43')
    expect(row('Packet C')).toHaveTextContent('10 pcs · Bench bin B3')
  })

  it('without a batch default, every lot names its location', () => {
    const { props, rerender } = setup()
    const noDefault = {
      ...batch,
      defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
    } as unknown as CaptureSnapshotDto
    rerender(<ReadyToAdd {...props} batch={noDefault} />)
    expect(screen.getByRole('checkbox', { name: 'Packet A' }).closest('label')).toHaveTextContent(
      '10 pcs · Bin 43',
    )
  })

  it('keeps the lots beside the Tree, and unticking a lot marks its stock item at once', async () => {
    const user = userEvent.setup()
    const { prepareLots } = setup()
    await user.click(await screen.findByRole('button', { name: 'Tree' }))
    const lotsPane = screen.getByRole('region', { name: 'Lots to include' })
    expect(lotsPane.parentElement).toHaveAttribute('data-view', 'tree')
    const tree = screen.getByRole('tree', { name: 'By category' })
    expect(within(tree).getByRole('treeitem', { name: /Packet A · 10/ })).toHaveTextContent('New')

    await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
    expect(prepareLots).toHaveBeenCalledWith([lots[1], lots[2]])
    // The lot list stays beside the tree, which shows the untick before the new preparation.
    expect(lotsPane).toBeVisible()
    const stock = within(tree).getByRole('treeitem', { name: /Packet A/ })
    expect(stock).toHaveTextContent('Not ticked')
    expect(stock).toHaveAttribute('data-dimmed', 'true')
    expect(within(stock).getByRole('link', { name: /^Review Packet A/ })).toBeVisible()
  })

  it('unticking a lot prepares the rest, and approval waits for that preparation', async () => {
    const user = userEvent.setup()
    const { prepareLots, props, rerender } = setup()
    expect(
      screen.getByRole('button', { name: 'Approve 3 lots and add to InvenTree' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'Packet B' }))
    expect(prepareLots).toHaveBeenCalledWith([lots[0], lots[2]])

    // While the new preparation is made, the shown one is no longer the operator's choice.
    rerender(<ReadyToAdd {...props} busy />)
    expect(screen.getByRole('button', { name: /Approve 3 lots/ })).toBeDisabled()
    const next = preview([lots[0], lots[2]], 51)
    rerender(
      <ReadyToAdd
        {...props}
        preview={next}
        pinnedPreparationId={next.id}
        workspace={workspace([next])}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Approve 2 lots and add to InvenTree' }),
    ).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Packet B' })).not.toBeChecked()
  })

  it('before anything is prepared, the ticked lots are the ones prepared', async () => {
    const user = userEvent.setup()
    const { prepareLots } = setup({ shown: null })
    await user.click(screen.getByRole('checkbox', { name: 'Packet B' }))
    expect(screen.getByRole('checkbox', { name: 'Packet B' })).not.toBeChecked()
    expect(prepareLots).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Show what will change' }))
    expect(prepareLots).toHaveBeenCalledWith([lots[0], lots[2]])
  })

  it('groups left-out lots by reason, with a count and a link to review them', () => {
    const { props, rerender } = setup({ shown: null })
    const unreviewed = {
      ...props.workspace,
      lots: props.workspace.lots.map((lot) =>
        lot.lot_id === lots[0] ? lot : { ...lot, reviewed: false },
      ),
    } as ManualWorkspaceDto
    rerender(<ReadyToAdd {...props} workspace={unreviewed} />)
    const group = screen.getByText('Not reviewed').closest('li')!
    expect(group).toHaveTextContent('2 lots')
    expect(within(group).getByRole('link', { name: 'Review them' })).toHaveAttribute(
      'href',
      expect.stringContaining('filter=needs_review'),
    )
  })

  it('a ticked lot that stops being ready drops out of the ticks', async () => {
    const user = userEvent.setup()
    const { prepareLots, props, rerender } = setup({ shown: null })
    await user.click(screen.getByRole('checkbox', { name: 'Packet B' }))
    const changed = {
      ...props.workspace,
      lots: props.workspace.lots.map((lot) =>
        lot.lot_id === lots[2]
          ? {
              ...lot,
              issues: [
                {
                  code: 'changed_after_review',
                  message: 'Changed',
                  lot_id: lot.lot_id,
                  run_id: null,
                },
              ],
            }
          : lot,
      ),
    } as ManualWorkspaceDto
    rerender(<ReadyToAdd {...props} workspace={changed} />)
    expect(screen.queryByRole('checkbox', { name: 'Packet C' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show what will change' }))
    expect(prepareLots).toHaveBeenCalledWith([lots[0]])
  })

  it('the same lots can be prepared again when the shown preparation is no longer current', async () => {
    const user = userEvent.setup()
    const { prepareLots } = setup({ current: [] })
    await user.click(screen.getByRole('button', { name: 'Show what will change' }))
    expect(prepareLots).toHaveBeenCalledWith(lots)
  })

  it('a stale preparation’s lot that changed since review is neither ticked nor prepared again', async () => {
    const user = userEvent.setup()
    const shown = preview(lots)
    const changed = {
      ...workspace([]),
      lots: lots.map((lot) => ({
        lot_id: lot,
        reviewed: true,
        issues:
          lot === lots[1]
            ? [
                {
                  code: 'changed_after_review',
                  message: 'Changed since review',
                  lot_id: lot,
                  run_id: null,
                },
              ]
            : [],
      })),
    } as unknown as ManualWorkspaceDto
    const prepareLots = vi.fn()
    render(
      <ReadyToAdd
        batch={batch}
        workspace={changed}
        preview={shown}
        pinnedPreparationId={shown.id}
        busy={false}
        choose={vi.fn()}
        prepareLots={prepareLots}
        approve={vi.fn()}
      />,
    )
    expect(screen.queryByRole('checkbox', { name: 'Packet B' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review it' }).closest('li')).toHaveTextContent(
      'Packet B',
    )
    await user.click(screen.getByRole('button', { name: 'Show what will change' }))
    expect(prepareLots).toHaveBeenCalledWith([lots[0], lots[2]])
  })

  it('a preparation that is no longer current cannot be approved', () => {
    setup({ current: [] })
    expect(screen.getByText(/This preparation is no longer current/)).toBeVisible()
    expect(screen.getByRole('button', { name: /Approve 3 lots/ })).toBeDisabled()
  })

  it('By type counts every record, matching the approve summary, and links to Review', async () => {
    setup()
    const footer = screen.getByRole('region', { name: 'Approve' })
    await waitFor(() => expect(footer).toHaveTextContent('3 new · 1 update'))
    expect(within(footer).getByText('Test InvenTree')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Stock items, 1' })).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Changes to existing records, 1' }),
    ).toHaveTextContent('S-47 · DigiKey')
    expect(screen.getByRole('region', { name: 'Parts, 1' })).toHaveTextContent(
      'Through-hole · Tags: SMD',
    )
    expect(screen.getByRole('link', { name: 'Packet A · 10' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/lots/${lots[0]}`,
    )
  })

  it('the tree counts its changes, expands or collapses all, and can show only changes', async () => {
    const user = userEvent.setup()
    setup({
      tree: [
        ...treeNodes,
        node({ key: 'category:82', kind: 'category', label: 'Capacitors', state: 'exists' }),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'Tree' }))
    const counts = screen.getByRole('group', { name: 'Tree counts' })
    expect(counts).toHaveTextContent('3 new')
    expect(counts).toHaveTextContent('1 update')
    expect(counts).toHaveTextContent('2 existing')
    const tree = screen.getByRole('tree', { name: 'By category' })

    const items = () => within(tree).getAllByRole('treeitem')

    expect(items()[1]).toHaveTextContent(/^.?part/i)

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(items()).toHaveLength(2)
    expect(items()[0]).toHaveTextContent('3 new · 1 update')
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(items()).toHaveLength(6)

    await user.click(screen.getByRole('checkbox', { name: 'Only changes' }))
    expect(items()).toHaveLength(5)
    expect(tree).not.toHaveTextContent('Capacitors')
  })

  it('the tree keeps an unticked lot with its reason, and an update says what it changes', async () => {
    const user = userEvent.setup()
    const left = id(990)
    setup({
      tree: [
        ...treeNodes,
        node({
          key: 'part:pk:42',
          kind: 'part',
          label: 'CAP 100nF',
          state: 'update',
          changes: [{ field: 'Image', before: null, after: 'Image for CAP 100nF' }],
        }),
        node({
          key: `unticked:${left}`,
          kind: 'stock_item',
          label: 'Packet B',
          state: 'not_ticked',
          detail: 'Changed since review',
          parent_key: 'part:p',
          lot_id: left,
        }),
      ],
    })
    // By type lists the change on the update and leaves the unticked lot out.
    const updates = await screen.findByRole('region', { name: 'Changes to existing records, 2' })
    expect(updates).toHaveTextContent('Image · none → Image for CAP 100nF')
    expect(screen.getByRole('region', { name: 'Stock items, 1' })).not.toHaveTextContent('Packet B')

    await user.click(screen.getByRole('button', { name: 'Tree' }))
    const tree = screen.getByRole('tree', { name: 'By category' })
    const row = within(tree).getByRole('treeitem', { name: /Packet B/ })
    expect(row).toHaveTextContent('Not ticked')
    expect(row).toHaveTextContent('Changed since review')
    expect(row).toHaveAttribute('data-dimmed', 'true')
    expect(within(row).getByRole('link', { name: 'Review Packet B' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/lots/${left}`,
    )
    expect(within(tree).getByRole('treeitem', { name: /CAP 100nF/ })).toHaveTextContent(
      'Image · none → Image for CAP 100nF',
    )
    // Leaving a lot out changes nothing in InvenTree.
    await user.click(screen.getByRole('checkbox', { name: 'Only changes' }))
    expect(within(tree).queryByRole('treeitem', { name: /Packet B/ })).toBeNull()
  })

  it('the tree follows the WAI-ARIA keyboard pattern and states each node in text', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: 'Tree' }))
    const tree = screen.getByRole('tree', { name: 'By category' })

    const items = () => within(tree).getAllByRole('treeitem')

    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Resistors.*Exists/),
      expect.stringMatching(/New resistor.*New/),
      expect.stringMatching(/Resistance: 4.7 kΩ.*New/),
      expect.stringMatching(/S-47 · DigiKey.*Update/),
      expect.stringMatching(/Packet A · 10 · No location.*New/),
    ])
    expect(items()[1]).toHaveAttribute('aria-posinset', '1')
    expect(items()[2]).toHaveAttribute('aria-setsize', '3')
    expect(items()[4]).toHaveAttribute('aria-posinset', '3')
    items()[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(items()[1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(items()[1]).toHaveAttribute('aria-expanded', 'false')
    expect(items()).toHaveLength(2)
    await user.keyboard('{ArrowLeft}')
    expect(items()[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(items()[1]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(items()).toHaveLength(5)
    await user.keyboard('{ArrowRight}')
    expect(items()[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items()[0]).toHaveFocus()
    expect(items().filter((item) => item.tabIndex === 0)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Location' }))
    expect(screen.getByRole('tree', { name: 'By location' })).toHaveTextContent('No location')
  })

  it('counts and By type follow the ticks the Tree shows, before the lots are prepared again', async () => {
    const user = userEvent.setup()
    const { prepareLots } = setup()
    const footer = screen.getByRole('region', { name: 'Approve' })
    await waitFor(() => expect(footer).toHaveTextContent('3 new · 1 update'))
    expect(screen.getByRole('region', { name: 'Stock items, 1' })).toBeVisible()

    await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
    expect(footer).toHaveTextContent('2 new · 1 update')
    expect(screen.getByText(/2 new · 1 update to InvenTree/)).toBeVisible()
    expect(screen.queryByRole('region', { name: /^Stock items/ })).not.toBeInTheDocument()
    expect(prepareLots).toHaveBeenCalled()
  })

  it('flags unticked lots shown as Not ticked while no preparation matches them', async () => {
    const user = userEvent.setup()
    const { props, rerender } = setup()
    await user.click(await screen.findByRole('button', { name: 'Tree' }))
    await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
    // The preparation failed: busy ends with the old preparation still shown.
    rerender(<ReadyToAdd {...props} busy />)
    rerender(<ReadyToAdd {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Lots you unticked show as Not ticked, but they aren’t prepared without them yet.',
    )
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show what will change' })).toBeEnabled()
  })

  it('without a tree, By type still shows stock, Parts and locations from the preview', async () => {
    setup({ tree: null })
    expect(await screen.findByText(/The full list isn’t available/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Tree' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stock items, 3' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Parts, 1' })).toHaveTextContent('Existing resistor')
  })
})
