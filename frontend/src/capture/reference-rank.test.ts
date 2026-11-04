import { expect, test } from 'vitest'
import { rankReferences, type RankableReference } from './reference-rank'

const records: RankableReference[] = [
  { pk: '7', name: 'Mouser Electronics', secondary: ['Distributor'] },
  { pk: '8', name: 'Digi-Key', secondary: ['Mouser alternative'] },
  {
    pk: '41',
    name: 'Incoming inspection drawer',
    secondary: ['Bench / Incoming inspection drawer'],
  },
  {
    pk: '42',
    name: 'Incoming inspection drawer',
    secondary: ['Store / Incoming inspection drawer'],
  },
  { pk: '50', name: 'Électronique Café', secondary: [] },
  { pk: '60', name: 'Resistor drawer', secondary: [] },
  { pk: '600', name: 'Capacitor shelf', secondary: [] },
]

const order = (query: string) => rankReferences(records, query).map((item) => item.record.pk)

test('typos match the intended record without changing its identity or label', () => {
  const mouser = rankReferences(records, 'Mousr')[0]
  expect(mouser).toMatchObject({ tier: 'fuzzy', record: records[0] })
  expect(order('Incomming').slice(0, 2)).toEqual(['41', '42'])
})

test('case, whitespace and accents are folded only for matching', () => {
  const [match] = rankReferences(records, '  electronique   CAFE ')
  expect(match.tier).toBe('exact_name')
  expect(match.record.name).toBe('Électronique Café')
})

test('exact ID and exact name precede prefix and fuzzy results with stable ID ties', () => {
  expect(rankReferences(records, '600').map((item) => item.tier)[0]).toBe('exact_id')
  expect(order('600')[0]).toBe('600')
  const exact = rankReferences(records, 'incoming inspection drawer')
  expect(exact.slice(0, 2).map((item) => [item.record.pk, item.tier])).toEqual([
    ['41', 'exact_name'],
    ['42', 'exact_name'],
  ])
})

test('names outweigh secondary fields', () => {
  expect(order('Mouser')).toEqual(['7', '8'])
})

test('a numeric query never fuzzy-substitutes another record', () => {
  expect(order('61')).toEqual([])
  expect(order('6')).toEqual([])
})

test('unrelated and very short queries do not produce noisy suggestions', () => {
  expect(order('Oscilloscope')).toEqual([])
  expect(order('zq')).toEqual([])
})

test('an empty query keeps the candidate order for browsing', () => {
  expect(order('')).toEqual(records.map((record) => record.pk))
})

test('IDs beyond the safe integer range keep exact numeric order', () => {
  const large = [
    { pk: '10000000000000000', name: 'Drawer', secondary: [] },
    { pk: '9999999999999999', name: 'Drawer', secondary: [] },
  ]
  expect(rankReferences(large, 'drawer').map((item) => item.record.pk)).toEqual([
    '9999999999999999',
    '10000000000000000',
  ])
})

test('a fuzzy name match precedes a record matching only in its secondary fields', () => {
  const ranked = rankReferences(
    [
      { pk: '1', name: 'Resistor drawer', secondary: ['inspection'] },
      { pk: '2', name: 'Incoming inspection drawer', secondary: ['Bench'] },
    ],
    'inspection',
  )
  expect(ranked.map((item) => [item.record.name, item.tier])).toEqual([
    ['Incoming inspection drawer', 'fuzzy'],
    ['Resistor drawer', 'fuzzy'],
  ])
})
