import type { CaptureSnapshotDto } from '@invimport/contracts'

/** How many current lots there are and when the last was formed; nothing while any time is unknown. */
export function lotsFormed(lots: readonly CaptureSnapshotDto['lots'][number][]) {
  const current = lots.filter((lot) => !lot.retired)
  const times = current.map((lot) => (lot.formed_at ? Date.parse(lot.formed_at) : Number.NaN))
  if (!current.length || times.some((time) => Number.isNaN(time))) {
    return undefined
  }

  return { count: current.length, at: new Date(Math.max(...times)).toISOString() }
}
