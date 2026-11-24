import styled from 'styled-components'
import {
  shownUnder,
  type ConversationFilter,
  type ConversationItem,
} from '#/processing/session-history'
import { space } from '#/theme/generated/tokens'
import { ConversationRow, type ConversationRowProps } from './ConversationRow'

type Props = Omit<ConversationRowProps, 'item'> & {
  items: ConversationItem[]
  filter: ConversationFilter
}

/**
 * The session as one conversation, oldest first. A filter hides rows rather than removing them,
 * so a question card's unsaved answer survives switching filters.
 */
export function SessionConversation({ items, filter, ...row }: Props) {
  return (
    <List aria-label="Session conversation">
      {items.map((item) => (
        <li key={item.id} hidden={!shownUnder(item, filter)}>
          <ConversationRow item={item} {...row} />
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
  gap: ${space[3]};
  min-width: 0;
`
