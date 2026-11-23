import { expect, it } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { lotsFormed } from './lots-formed'

type Lot = CaptureSnapshotDto['lots'][number]

const lot = (formed_at?: string, retired = false) =>
  ({ id: formed_at ?? 'x', retired, ...(formed_at ? { formed_at } : {}) }) as unknown as Lot

it("counts the batch's lots and names when the last of them was formed", () => {
  const lots = [lot('2026-11-08T09:12:00.000Z'), lot('2026-11-08T09:40:00.000Z')]
  expect(lotsFormed(lots)).toEqual({ count: 2, at: '2026-11-08T09:40:00.000Z' })
  expect(lotsFormed([lot('2026-11-08T09:12:00.000Z')])).toEqual({
    count: 1,
    at: '2026-11-08T09:12:00.000Z',
  })
})

it('leaves retired lots out, and says nothing without lots or when any time is unknown', () => {
  expect(
    lotsFormed([lot('2026-11-08T09:12:00.000Z'), lot('2026-11-08T11:00:00.000Z', true)]),
  ).toEqual({ count: 1, at: '2026-11-08T09:12:00.000Z' })
  expect(lotsFormed([])).toBeUndefined()
  expect(lotsFormed([lot('2026-11-08T09:12:00.000Z'), lot()])).toBeUndefined()
})
