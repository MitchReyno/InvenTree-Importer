import type { HistoryItem } from '#/processing/session-history'
import type { HistoryContext } from './HistoryLinks'
import { HistoryRow } from './HistoryRow'
import { HistoryRows } from './history-row-styles'

/** A session's history rows, as the drawer shows them. */
export function HistoryList({
  label,
  items,
  context,
}: {
  label: string
  items: HistoryItem[]
  context: HistoryContext
}) {
  return (
    <HistoryRows aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <HistoryRow item={item} context={context} />
        </li>
      ))}
    </HistoryRows>
  )
}
