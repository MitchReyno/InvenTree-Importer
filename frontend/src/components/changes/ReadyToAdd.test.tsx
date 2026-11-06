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
import { render } from '../../test/render'
import { ReadyToAdd } from './ReadyToAdd'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const lots = [1, 2, 3].map((n) => id(100 + n))
const batch = {
  id: id(1),
  archived: false,
  lots: lots.map((lot, index) => ({ id: lot, label: `Packet ${'ABC'[index]}` })),
} as unknown as CaptureSnapshotDto

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
      location_id: '43',
      location_label: 'Bin 43',
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
    ...value,
  }) as PreparationNodeDto

const treeNodes = [
  node({ key: 'category:81', kind: 'category', label: 'Resistors', state: 'exists' }),
  node({ key: 'part:p', kind: 'part', label: 'New resistor', parent_key: 'category:81' }),
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
    shown?: ManualPreviewDto
    current?: ManualPreviewDto[]
    tree?: PreparationNodeDto[] | null
  } = {},
) {
  const shown = options.shown ?? preview(lots)
  const prepareLots = vi.fn()
  const approve = vi.fn()
  const readTree = vi.fn(async (preparationId: string): Promise<PreparationTreeDto> => ({
    preparation_id: preparationId,
    plan_version: 'bench-effects-plan/2',
    nodes: options.tree === undefined ? treeNodes : options.tree,
  }))
  const props = {
    batch,
    workspace: workspace(options.current ?? [shown]),
    preview: shown,
    pinnedPreparationId: shown.id,
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
    expect(screen.getByRole('link', { name: 'Packet A · 10' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/lots/${lots[0]}`,
    )
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
      expect.stringMatching(/Packet A · 10.*New/),
    ])
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

  it('without a tree, By type still shows stock, Parts and locations from the preview', async () => {
    setup({ tree: null })
    expect(await screen.findByText(/The full list isn’t available/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Tree' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stock items, 3' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Parts, 1' })).toHaveTextContent('Existing resistor')
  })
})
