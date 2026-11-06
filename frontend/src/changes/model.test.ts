import { describe, expect, it } from 'vitest'
import type { PreparationNodeDto } from '@invimport/contracts'
import {
  byType,
  categoryTree,
  flatten,
  leftOutLots,
  locationTree,
  readyLotIds,
  summary,
} from './model'

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

const lot = (n: number) => `00000000-0000-4000-8000-00000000010${n}`

const subject = '00000000-0000-4000-8000-000000000010'

const nodes: PreparationNodeDto[] = [
  node({ key: 'category:81', kind: 'category', label: 'Resistors', state: 'exists' }),
  node({ key: 'company:12', kind: 'company', label: 'Yageo', state: 'exists' }),
  node({ key: 'location:43', kind: 'location', label: 'Bin 43', state: 'exists' }),
  node({ key: 'location:new:x', kind: 'location', label: 'Shelf B' }),
  node({ key: 'part:pk:29', kind: 'part', label: 'Existing', state: 'exists' }),
  node({
    key: `part:${subject}`,
    kind: 'part',
    label: 'New resistor',
    parent_key: 'category:81',
    part_subject_id: subject,
  }),
  node({
    key: 'parameter:1',
    kind: 'parameter',
    parent_key: `part:${subject}`,
    part_subject_id: subject,
  }),
  node({
    key: 'supplier_part:1',
    kind: 'supplier_part',
    parent_key: `part:${subject}`,
    part_subject_id: subject,
  }),
  node({
    key: `stock:${lot(1)}`,
    kind: 'stock_item',
    label: 'Lot 1 · 10',
    parent_key: `part:${subject}`,
    location_key: 'location:43',
    lot_id: lot(1),
  }),
  node({
    key: `stock:${lot(2)}`,
    kind: 'stock_item',
    label: 'Lot 2 · 5',
    parent_key: 'part:pk:29',
    location_key: 'location:new:x',
    lot_id: lot(2),
  }),
  node({
    key: `stock:${lot(3)}`,
    kind: 'stock_item',
    label: 'Lot 3 · 1',
    parent_key: 'part:pk:29',
    lot_id: lot(3),
  }),
  node({
    key: 'attachment:a',
    kind: 'attachment',
    label: 'Bag photo',
    parent_key: `stock:${lot(1)}`,
    lot_id: lot(1),
  }),
]

const countBy = (list: PreparationNodeDto[]) =>
  list.reduce<Record<string, number>>((counts, item) => {
    const key = `${item.kind}:${item.state}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})

describe('preparation views', () => {
  it('the tree and By type count the same records in each state', () => {
    const typed = byType(nodes)
    const fromTypes = countBy(typed.flatMap((section) => section.nodes))
    const inCategoryTree = flatten(categoryTree(nodes))
    expect(countBy(nodes)).toEqual(fromTypes)
    // The category view leaves out companies and locations, which it names on their rows.
    for (const [key, count] of Object.entries(countBy(inCategoryTree))) {
      expect(fromTypes[key]).toBe(count)
    }
    expect(inCategoryTree).toHaveLength(
      nodes.filter((item) => item.kind !== 'company' && item.kind !== 'location').length,
    )
    const inLocationTree = flatten(locationTree(nodes)).filter((item) => item.kind !== 'location')
    expect(inLocationTree.map((item) => item.key).sort()).toEqual(
      nodes
        .filter((item) => item.kind === 'stock_item' || item.lot_id)
        .map((item) => item.key)
        .sort(),
    )
  })

  it('groups By type in the operator’s order and totals new and updated records', () => {
    expect(byType(nodes).map((section) => [section.title, section.nodes.length])).toEqual([
      ['Stock items', 3],
      ['Parts', 2],
      ['Categories', 1],
      ['Companies', 1],
      ['Supplier parts', 1],
      ['Parameters', 1],
      ['Images and attachments', 1],
      ['Locations', 2],
    ])
    expect(summary(nodes)).toEqual({ new: 8, update: 0 })
  })

  it('nests the category view under categories and the location view under locations', () => {
    const tree = categoryTree(nodes)
    expect(tree.map((item) => item.node.key)).toEqual(['category:81', 'part:pk:29'])
    expect(tree[0].children[0].children.map((item) => item.node.kind)).toEqual([
      'parameter',
      'supplier_part',
      'stock_item',
    ])
    expect(tree[0].children[0].children[2].node.label).toBe('Lot 1 · 10 · Bin 43')
    expect(tree[1].children.map((item) => item.node.label)).toEqual([
      'Lot 2 · 5 · Shelf B',
      'Lot 3 · 1 · No location',
    ])
    const byPlace = locationTree(nodes)
    expect(byPlace.map((item) => item.node.label)).toEqual(['Bin 43', 'Shelf B', 'No location'])
    const lost = locationTree([
      ...nodes.filter((item) => item.kind !== 'location' || item.key !== 'location:new:x'),
    ])
    expect(lost.at(-1)?.children.map((item) => item.node.key)).toEqual([
      `stock:${lot(2)}`,
      `stock:${lot(3)}`,
    ])
    expect(byPlace[0].children[0].children.map((item) => item.node.label)).toEqual(['Bag photo'])
  })
})

describe('lots for Ready to add', () => {
  const workspace = {
    lots: [
      { lot_id: lot(1), reviewed: true, issues: [] },
      { lot_id: lot(2), reviewed: false, issues: [] },
      {
        lot_id: lot(3),
        reviewed: true,
        issues: [{ code: 'quantity_required', message: 'Set it', lot_id: lot(3), run_id: null }],
      },
      {
        lot_id: lot(4),
        reviewed: true,
        issues: [
          {
            code: 'original_contribution_already_approved',
            message: 'Done',
            lot_id: lot(4),
            run_id: null,
          },
        ],
      },
      {
        lot_id: lot(5),
        reviewed: true,
        issues: [
          {
            code: 'warning_unresolved',
            message: 'Check the warning',
            lot_id: lot(5),
            run_id: null,
          },
        ],
      },
      {
        lot_id: lot(6),
        reviewed: true,
        issues: [
          {
            code: 'source_history_unsettled',
            message: 'An earlier run blocks it',
            lot_id: lot(6),
            run_id: null,
          },
        ],
      },
    ],
  }

  it('offers reviewed lots without problems, and names why others are left out', () => {
    expect(readyLotIds(workspace)).toEqual([lot(1)])
    expect(leftOutLots(workspace)).toEqual([
      { lotId: lot(2), reason: 'Not reviewed', filter: 'needs_review' },
      { lotId: lot(3), reason: 'Set it', filter: 'blocking' },
      { lotId: lot(5), reason: 'Check the warning', filter: 'warnings' },
      { lotId: lot(6), reason: 'An earlier run blocks it', filter: 'all' },
    ])
  })
})
