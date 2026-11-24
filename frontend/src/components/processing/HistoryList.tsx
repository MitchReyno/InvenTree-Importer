import styled from 'styled-components'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import { EventTime, Link } from '#/components/ui'
import { sessionPageHref } from '#/navigation/batch-route'
import type { HistoryItem } from '#/processing/session-history'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { HistoryEntryDetails, hasDetails } from './HistoryEntryDetails'
import { HistoryLinks, type HistoryContext } from './HistoryLinks'

/** Who an input is from, and whether the session has read it yet. */
function InputMark({ entry }: { entry: SessionHistoryEntryDto }) {
  if (entry.who === 'agent') {
    return null
  }
  return (
    <Who>
      {entry.who === 'operator' ? 'You' : 'App'}
      {!entry.read && <Unread> · Not read yet</Unread>}
    </Who>
  )
}

function Line({ entry }: { entry: SessionHistoryEntryDto }) {
  return (
    <>
      <InputMark entry={entry} />
      <Text>{entry.summary}</Text>
      <Time>
        <EventTime at={entry.at} />
      </Time>
    </>
  )
}

/** One entry: a line, or native `<details>` that expands to its details and links. */
export function HistoryEntry({
  entry,
  context,
}: {
  entry: SessionHistoryEntryDto
  context: HistoryContext
}) {
  const expandable = hasDetails(entry) || entry.links.length > 0
  if (!expandable) {
    return (
      <Plain $mine={entry.who !== 'agent'} id={entry.id}>
        <Line entry={entry} />
      </Plain>
    )
  }
  return (
    <Expandable $mine={entry.who !== 'agent'} id={entry.id}>
      <summary>
        <Line entry={entry} />
      </summary>
      <Body>
        <HistoryEntryDetails entry={entry} context={context} />
        <HistoryLinks links={entry.links} context={context} />
      </Body>
    </Expandable>
  )
}

/** One row of a history list: an entry, a group that expands to its entries, or a folded line. */
export function HistoryRow({ item, context }: { item: HistoryItem; context: HistoryContext }) {
  switch (item.kind) {
    case 'entry':
      return <HistoryEntry entry={item.entry} context={context} />
    case 'group':
      return (
        <Expandable $mine={false}>
          <summary>
            <Text>{item.summary}</Text>
            <Time>
              <EventTime at={item.entries[item.entries.length - 1].at} />
            </Time>
          </summary>
          <Nested>
            {item.entries.map((entry) => (
              <li key={entry.id}>
                <HistoryEntry entry={entry} context={context} />
              </li>
            ))}
          </Nested>
        </Expandable>
      )
    case 'elided':
      return (
        <Plain $mine={false}>
          <Text>
            {item.summary} ·{' '}
            <Link href={sessionPageHref(context.batchId, context.step, context.jobId)}>
              see full session
            </Link>
          </Text>
        </Plain>
      )
  }
}

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
    <List aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <HistoryRow item={item} context={context} />
        </li>
      ))}
    </List>
  )
}

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`

const Nested = styled(List)`
  margin-top: ${space[3]};
  padding-left: ${space[5]};
`

const row = `
  min-width: 0;
  overflow-wrap: anywhere;
`

const Plain = styled.div<{ $mine: boolean }>`
  ${row}
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[3]};
  padding: ${space[2]} ${space[3]};
  border-left: 2px solid ${({ $mine }) => ($mine ? color.accent : 'transparent')};
`

const Expandable = styled.details<{ $mine: boolean }>`
  ${row}
  padding: ${space[2]} ${space[3]};
  border-radius: ${radius.sm};
  border-left: 2px solid ${({ $mine }) => ($mine ? color.accent : 'transparent')};
  > summary {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[1]} ${space[3]};
    cursor: pointer;
  }
  &[open] {
    background: ${color.surface2};
  }
`

const Body = styled.div`
  display: grid;
  gap: ${space[3]};
  margin-top: ${space[3]};
  p,
  ul,
  ol {
    margin: 0;
  }
`

const Text = styled.span`
  flex: 1 1 12rem;
  min-width: 0;
`

const Who = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  text-transform: uppercase;
  letter-spacing: ${typeVar.label.letterSpacing};
  color: ${color.accent};
`

const Unread = styled.span`
  color: ${color.warn};
`

const Time = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
