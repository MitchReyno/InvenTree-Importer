import { describe, expect, it } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { reviewMap } from './review-map'
import { predecessorLotIds } from './review-model'

const lot = (id: string, label: string, part: string | null = null) => ({
  id,
  label,
  part_subject_id: part,
})

const batch = {
  lots: [
    lot('a', 'Packet A', 'p1'),
    lot('b', 'Packet B', 'p1'),
    lot('c', 'Bag'),
    lot('old', 'Old'),
  ],
} as unknown as CaptureSnapshotDto

const file = (id: string, label: string, linked: string[]) => ({
  id,
  label,
  linked_subject_ids: linked,
})

const evidence = [
  file('f1', 'Front label', ['a']),
  file('f2', 'Packing slip', ['p1']),
  file('f3', 'Bag photo', ['c']),
  file('f4', 'Stray photo', []),
  file('f5', 'Old photo', ['old']),
] as unknown as MediaSnapshotDto['evidence']

describe('reviewMap', () => {
  it('links each file to the active lots it supports, directly or through their Part', () => {
    const map = reviewMap(batch, evidence, new Set(['old']))

    expect(map.files.map((item) => [item.id, item.lotIds])).toEqual([
      ['f1', ['a']],
      ['f2', ['a', 'b']],
      ['f3', ['c']],
      ['f4', []],
      ['f5', []],
    ])
    expect(map.files[1].links).toEqual([
      { lotId: 'a', via: 'part' },
      { lotId: 'b', via: 'part' },
    ])
    expect(map.files[0].links).toEqual([{ lotId: 'a', via: 'direct' }])
    expect(map.lots.map((item) => [item.id, item.fileIds])).toEqual([
      ['a', ['f1', 'f2']],
      ['b', ['f2']],
      ['c', ['f3']],
    ])
  })

  it('flags files no active lot uses and lots resting on one file', () => {
    const map = reviewMap(batch, evidence, new Set(['old']))

    expect(map.files.filter((item) => item.unused).map((item) => item.id)).toEqual(['f4', 'f5'])
    expect(map.lots.filter((item) => item.singleSource).map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('numbers files that share a name, so each row and its controls can be told apart', () => {
    const twins = [
      file('x1', 'photo.png', ['a']),
      file('x2', 'photo.png', []),
      file('x3', 'label.png', ['a']),
    ] as unknown as MediaSnapshotDto['evidence']
    const map = reviewMap(batch, twins, new Set())

    expect(map.files.map((item) => item.label)).toEqual([
      'photo.png (1)',
      'photo.png (2)',
      'label.png',
    ])
  })

  it('counts evidence of a split or merged lot as support for its successors', () => {
    const lineage = {
      lots: [lot('s1', 'Half one'), lot('s2', 'Half two'), lot('m', 'Merged')],
    } as unknown as CaptureSnapshotDto
    const files = [
      file('photo', 'photo.jpg', ['old']),
      file('slip', 'slip.jpg', ['s2']),
    ] as unknown as MediaSnapshotDto['evidence']
    // old split into s1 and s2; s2 was later merged into m along with s1.
    const predecessors = predecessorLotIds({
      retired_lots: [
        { lot_id: 'old', successor_lot_ids: ['s1', 's2'] },
        { lot_id: 's1', successor_lot_ids: ['m'] },
        { lot_id: 's2', successor_lot_ids: ['m'] },
      ],
    } as unknown as OperatorReviewDto)
    const map = reviewMap(
      { ...lineage, lots: [...lineage.lots, lot('old', 'Old')] } as CaptureSnapshotDto,
      files,
      new Set(['old', 's1', 's2']),
      predecessors,
    )

    expect(map.files[0]).toMatchObject({ unused: false, links: [{ lotId: 'm', via: 'earlier' }] })
    expect(map.files[1].links).toEqual([{ lotId: 'm', via: 'earlier' }])
    expect(map.lots).toEqual([
      { id: 'm', label: 'Merged', fileIds: ['photo', 'slip'], singleSource: false },
    ])
  })

  it('stops walking a lineage that loops', () => {
    const predecessors = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ])
    const map = reviewMap(batch, [file('x', 'x.jpg', ['b'])] as never, new Set(), predecessors)

    expect(map.files[0].links).toEqual([
      { lotId: 'a', via: 'earlier' },
      { lotId: 'b', via: 'direct' },
    ])
  })
})
