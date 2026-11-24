import styled from 'styled-components'
import { EventTime, Link } from '#/components/ui'
import { sessionPageHref } from '#/navigation/batch-route'
import type { HistoryItem } from '#/processing/session-history'
import { space } from '#/theme/generated/tokens'
import { HistoryEntry } from './HistoryEntry'
import type { HistoryContext } from './HistoryLink'
import {
  HistoryDetails,
  HistoryLine,
  HistoryRows,
  HistoryText,
  HistoryTime,
} from './history-row-styles'

/** One row of a history list: an entry, a group that expands to its entries, or a folded line. */
export function HistoryRow({ item, context }: { item: HistoryItem; context: HistoryContext }) {
  switch (item.kind) {
    case 'entry':
      return <HistoryEntry entry={item.entry} context={context} />
    case 'group':
      return (
        <HistoryDetails $input={false}>
          <summary>
            <HistoryText>{item.summary}</HistoryText>
            <HistoryTime>
              <EventTime at={item.entries[item.entries.length - 1].at} />
            </HistoryTime>
          </summary>
          <Nested>
            {item.entries.map((entry) => (
              <li key={entry.id}>
                <HistoryEntry entry={entry} context={context} />
              </li>
            ))}
          </Nested>
        </HistoryDetails>
      )
    case 'elided':
      return (
        <HistoryLine $input={false}>
          <HistoryText>
            {item.summary} ·{' '}
            <Link href={sessionPageHref(context.batchId, context.step, context.jobId)}>
              see full session
            </Link>
          </HistoryText>
        </HistoryLine>
      )
  }
}

const Nested = styled(HistoryRows)`
  margin-top: ${space[3]};
  padding-left: ${space[5]};
`
