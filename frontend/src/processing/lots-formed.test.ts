import { expect, it } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { lotsFormed } from './lots-formed'

type Lot = CaptureSnapshotDto['lots'][number]

const lot = (formed_at?: string, retired = false) =>
  ({ id: formed_at ?? 'x', retired, ...(formed_at ? { formed_at } : {}) }) as unknown as Lot

const clock = (at: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))

it("counts the batch's lots and names when the last of them was formed", () => {
  const lots = [lot('2026-11-08T09:12:00.000Z'), lot('2026-11-08T09:40:00.000Z')]
  expect(lotsFormed(lots)).toBe(`2 lots formed by ${clock('2026-11-08T09:40:00.000Z')}`)
  expect(lotsFormed([lot('2026-11-08T09:12:00.000Z')])).toBe(
    `1 lot formed by ${clock('2026-11-08T09:12:00.000Z')}`,
  )
})

it('leaves retired lots out, and says nothing without lots or when any time is unknown', () => {
  expect(lotsFormed([lot('2026-11-08T09:12:00.000Z'), lot('2026-11-08T11:00:00.000Z', true)])).toBe(
    `1 lot formed by ${clock('2026-11-08T09:12:00.000Z')}`,
  )
  expect(lotsFormed([])).toBeUndefined()
  expect(lotsFormed([lot('2026-11-08T09:12:00.000Z'), lot()])).toBeUndefined()
})
