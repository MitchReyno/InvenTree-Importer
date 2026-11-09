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
      {
        id: 'm',
        label: 'Merged',
        fileIds: ['photo', 'slip'],
        observations: 0,
        singleSource: false,
        counted: null,
        seenAgain: 0,
      },
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

describe('reviewMap at region level', () => {
  const observation = (
    id: string,
    version: string,
    lotId: string | null,
    markings: string[],
    status = 'active',
  ) => ({
    id,
    evidence_version_id: version,
    page: null,
    region: {
      kind: 'pixels',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      source_width: 100,
      source_height: 100,
    },
    readings: { markings, text: null },
    visible_count: null,
    status,
    lot_id: lotId,
  })

  const withVersions = [
    { ...evidence[3], versions: [{ id: 'v4', evidence_id: 'f4' }] },
    { ...evidence[0], versions: [{ id: 'v1', evidence_id: 'f1' }] },
  ] as unknown as MediaSnapshotDto['evidence']
  const observed = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v4', 'c', ['1N4148']),
      observation('o2', 'v4', 'b', []),
      observation('o3', 'v4', null, ['LM358']),
      observation('o4', 'v4', 'a', ['ignored'], 'suggested'),
    ],
  } as unknown as CaptureSnapshotDto

  it('lists each file’s regions with the lot each supports, and a region link counts as use', () => {
    const map = reviewMap(observed, withVersions, new Set(['old']))
    const stray = map.files.find((item) => item.id === 'f4')!
    expect(stray.regions).toEqual([
      { id: 'o1', label: '1N4148', lotId: 'c', kind: 'pixels' },
      { id: 'o2', label: 'Region 2', lotId: 'b', kind: 'pixels' },
      { id: 'o3', label: 'LM358', lotId: null, kind: 'pixels' },
    ])
    expect(stray.unused).toBe(false)
    expect(stray.lotIds).toEqual(['c', 'b'])
    expect(map.lots.find((item) => item.id === 'b')?.fileIds).toEqual(['f4'])
    expect(map.files.find((item) => item.id === 'f1')?.regions).toEqual([])
  })

  it('draws a region or direct link solid, and a document line or Part link dotted', () => {
    const lines = {
      ...observation('o5', 'v1', 'b', ['Line 8']),
      region: { kind: 'lines', from_line: 8, to_line: 8 },
    }
    const map = reviewMap(
      { ...observed, evidence_observations: [...observed.evidence_observations!, lines] } as never,
      [...withVersions, evidence[1]] as never,
      new Set(['old']),
    )
    expect(map.files.find((item) => item.id === 'f4')?.edges).toEqual([
      { lotId: 'c', style: 'solid' },
      { lotId: 'b', style: 'solid' },
    ])
    expect(map.files.find((item) => item.id === 'f1')?.edges).toEqual([
      { lotId: 'a', style: 'solid' },
      { lotId: 'b', style: 'dotted' },
    ])
    expect(map.files.find((item) => item.id === 'f2')?.edges).toEqual([
      { lotId: 'a', style: 'dotted' },
      { lotId: 'b', style: 'dotted' },
    ])
  })

  it('counts each lot’s observations, and flags a lot on one observation, not one photo', () => {
    const twoOfOne = {
      ...observed,
      evidence_observations: [
        ...observed.evidence_observations!,
        observation('o6', 'v4', 'c', ['1N4148 again']),
      ],
    } as unknown as CaptureSnapshotDto
    const map = reviewMap(twoOfOne, withVersions, new Set(['old']))
    const byId = new Map(map.lots.map((item) => [item.id, item]))
    expect(byId.get('c')).toMatchObject({ observations: 2, singleSource: false })
    expect(byId.get('b')).toMatchObject({ observations: 1, singleSource: true })
  })

  it('has no regions before observations exist', () => {
    const map = reviewMap(batch, withVersions, new Set())
    expect(map.files.every((item) => item.regions.length === 0)).toBe(true)
  })
})
