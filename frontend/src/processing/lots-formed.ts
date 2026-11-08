import type { CaptureSnapshotDto } from '@invimport/contracts'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** "N lots formed by HH:MM" for the batch's current lots; nothing while any time is unknown. */
export function lotsFormed(lots: readonly CaptureSnapshotDto['lots'][number][]) {
  const current = lots.filter((lot) => !lot.retired)
  const times = current.map((lot) => (lot.formed_at ? Date.parse(lot.formed_at) : Number.NaN))
  if (!current.length || times.some((time) => Number.isNaN(time))) {
    return undefined
  }

  const count = current.length === 1 ? '1 lot' : `${current.length} lots`
  return `${count} formed by ${clock.format(new Date(Math.max(...times)))}`
}
