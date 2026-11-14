import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lotLocationGroups,
  resolveLotLocation,
  validate,
  type CaptureSnapshotDto,
  type LotLocationGroups,
} from '../src/index.ts'

const context = '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03'
const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`
const ref = (pk: string) => ({
  observation_id: id(900 + Number(pk)),
  target_context_id: context,
  model: 'location' as const,
  pk,
})
const set = (pk: string) => ({ mode: 'set' as const, value: ref(pk) })
const clear = { mode: 'clear' as const }
const inherit = { mode: 'inherit' as const }

const partA = id(10)
const partB = id(11)
const groupX = id(20)
const groupY = id(21)
const groupZ = id(22)

function lot(
  n: number,
  part: string | null,
  location: CaptureSnapshotDto['lots'][number]['location'],
) {
  return {
    id: id(100 + n),
    label: `Lot ${n}`,
    revision: '1',
    contribution_key: id(200 + n),
    part_subject_id: part,
    quantity: { mode: 'set' as const, value: '7' },
    location,
  }
}

const snapshot: CaptureSnapshotDto = {
  id: id(1),
  source_id: id(2),
  title: 'Location matrix',
  revision: '9',
  archived: false,
  updated_at: '2026-11-05T00:00:00Z',
  actor_id: id(3),
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: set('1') },
  parts: [
    { id: partA, label: 'Part A', revision: '1', choice: { mode: 'unset' }, location: set('2') },
    { id: partB, label: 'Part B', revision: '1', choice: { mode: 'unset' } },
  ],
  group_locations: [
    { group_id: groupX, version: '1', location: set('3') },
    { group_id: groupY, version: '1', location: set('4') },
    { group_id: groupZ, version: '1', location: clear },
  ],
  lots: [
    lot(1, partA, set('5')), // explicit lot
    lot(2, partA, inherit), // shared Part
    lot(3, partB, inherit), // one group
    lot(4, partB, inherit), // conflicting groups
    lot(5, null, inherit), // batch default
    lot(6, partA, inherit), // Part outranks conflicting groups
    lot(7, partB, inherit), // group clear suppresses the batch default
    lot(8, partB, inherit), // two groups agreeing
    lot(9, null, clear), // explicit lot clear
    lot(10, null, { mode: 'unknown' }), // explicit lot unknown still blocks
  ],
  notes: [],
  observations: [],
  cursor: { stream_id: id(4), sequence: '0' },
}

const groups: LotLocationGroups = new Map([
  [id(103), [groupX]],
  [id(104), [groupX, groupY]],
  [id(106), [groupX, groupY]],
  [id(107), [groupZ]],
  [id(108), [groupX, groupX]],
])

const resolve = (n: number, lotGroups: LotLocationGroups | null = groups) =>
  resolveLotLocation(
    snapshot,
    snapshot.lots.find((value) => value.id === id(100 + n))!,
    lotGroups,
  )

test('the extended snapshot validates and the legacy shape still does', () => {
  validate('CaptureSnapshot', snapshot)
  const { group_locations: _groups, ...legacy } = snapshot
  validate('CaptureSnapshot', {
    ...legacy,
    parts: legacy.parts.map(({ location: _location, ...part }) => part),
  })
})

test('each precedence level resolves per physical lot: lot, shared Part, group, batch', () => {
  assert.deepEqual(resolve(1), { status: 'resolved', source: 'lot', location: set('5') })
  assert.deepEqual(resolve(2), { status: 'resolved', source: 'part', location: set('2') })
  assert.deepEqual(resolve(3), {
    status: 'resolved',
    source: 'group',
    location: set('3'),
    group_ids: [groupX],
  })
  assert.deepEqual(resolve(5), { status: 'resolved', source: 'batch', location: set('1') })
})

test('different group locations block unless a higher level applies', () => {
  assert.deepEqual(resolve(4), { status: 'conflict', group_ids: [groupX, groupY] })
  assert.deepEqual(resolve(6), { status: 'resolved', source: 'part', location: set('2') })
})

test('agreeing groups resolve once and an explicit clear suppresses lower fallback', () => {
  assert.deepEqual(resolve(8), {
    status: 'resolved',
    source: 'group',
    location: set('3'),
    group_ids: [groupX],
  })
  assert.deepEqual(resolve(7), {
    status: 'resolved',
    source: 'group',
    location: clear,
    group_ids: [groupZ],
  })
  assert.deepEqual(resolve(9), { status: 'resolved', source: 'lot', location: clear })
  assert.deepEqual(resolve(10), {
    status: 'resolved',
    source: 'lot',
    location: { mode: 'unknown' },
  })
})

test('unknown group membership blocks only lots that would fall through to group level', () => {
  assert.deepEqual(resolve(3, null), { status: 'groups_unavailable' })
  assert.deepEqual(resolve(2, null), { status: 'resolved', source: 'part', location: set('2') })
  assert.deepEqual(resolve(1, null), { status: 'resolved', source: 'lot', location: set('5') })
  const withoutGroups = { ...snapshot, group_locations: [] }
  assert.deepEqual(resolveLotLocation(withoutGroups, withoutGroups.lots[4], null), {
    status: 'resolved',
    source: 'batch',
    location: set('1'),
  })
})

test('changing the batch default changes only fallback lots', () => {
  const changed = { ...snapshot, defaults: { ...snapshot.defaults, location: set('8') } }
  const before = snapshot.lots.map((value) => resolveLotLocation(snapshot, value, groups))
  const after = changed.lots.map((value) => resolveLotLocation(changed, value, groups))
  const moved = after.flatMap((value, index) =>
    JSON.stringify(value) === JSON.stringify(before[index]) ? [] : [index + 1],
  )
  assert.deepEqual(moved, [5])
  assert.deepEqual(
    changed.lots.map((value) => value.quantity),
    snapshot.lots.map((value) => value.quantity),
  )
})

test('group membership comes from linked evidence, deduplicated and ordered', () => {
  const map = lotLocationGroups([
    { group_id: groupY, linked_subject_ids: [id(101), id(102)] },
    { group_id: groupX, linked_subject_ids: [id(101)] },
    { group_id: groupX, linked_subject_ids: [id(101)] },
    { group_id: null, linked_subject_ids: [id(103)] },
  ])
  assert.deepEqual(map.get(id(101)), [groupX, groupY])
  assert.deepEqual(map.get(id(102)), [groupY])
  assert.equal(map.has(id(103)), false)
})

test('a cleared shared-Part location stops group and batch fallback', () => {
  const cleared = {
    ...snapshot,
    parts: snapshot.parts.map((part) =>
      part.id === partB ? { ...part, location: { mode: 'clear' as const } } : part,
    ),
  }
  for (const n of [3, 4, 7]) {
    assert.deepEqual(
      resolveLotLocation(
        cleared,
        cleared.lots.find((value) => value.id === id(100 + n))!,
        groups,
      ),
      { status: 'resolved', source: 'part', location: clear },
    )
  }
})
