import { describe, expect, it } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { reviewMap } from './review-map'

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
})
