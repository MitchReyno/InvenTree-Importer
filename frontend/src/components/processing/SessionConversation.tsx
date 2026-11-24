import styled, { css } from 'styled-components'
import { motion } from '#/components/ui'
import {
  railMarks,
  shownUnder,
  type ConversationFilter,
  type ConversationItem,
} from '#/processing/session-history'
import { color, space } from '#/theme/generated/tokens'
import { ChatBubble } from './ChatBubble'
import { ConversationRow, type ConversationRowProps } from './ConversationRow'

type Props = Omit<ConversationRowProps, 'item'> & {
  items: ConversationItem[]
  filter?: ConversationFilter
  label: string
  /** The session is working now, so its latest action carries the "now" dot. */
  working: boolean
  /** A message being sent, shown last until a read returns it in its place. */
  sending?: string
}

/**
 * A session's history as one conversation, oldest first, beside a rail: a dot on each of the
 * agent's actions and none on messages, a solid line between adjacent actions and a dashed one
 * across what comes between. A filter hides rows rather than removing them, so a question card's
 * unsaved answer survives switching filters.
 */
export function SessionConversation({
  items,
  filter = 'all',
  label,
  working,
  sending,
  ...row
}: Props) {
  // A filtered view hides rows, so only the full list draws the rail.
  const marks = railMarks(items, working)
  const rail = filter === 'all'

  return (
    <List aria-label={label}>
      {items.map((item, index) => (
        <Row
          key={item.id}
          hidden={!shownUnder(item, filter)}
          data-rail={rail && marks[index].action ? 'action' : undefined}
          data-line={(rail && marks[index].line) || undefined}
          data-now={(rail && marks[index].now) || undefined}
          aria-current={rail && marks[index].now ? 'step' : undefined}
        >
          <ConversationRow item={item} {...row} />
        </Row>
      ))}
      {sending !== undefined && (
        <Row aria-label="Your message, sending">
          <ChatBubble mine author="You" text={sending} />
        </Row>
      )}
    </List>
  )
}

const DOT = space[4]
const NOW_DOT = space[5]
/** The rail's centre line, and how far down a row its dot's centre sits. */
const RAIL_X = space[4]
const DOT_Y = space[5]

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[3]};
  min-width: 0;
`

const line = css`
  content: '';
  position: absolute;
  left: calc(${RAIL_X} - ${space[1]} / 2);
  width: ${space[1]};
  top: ${DOT_Y};
  /* Down to the next row's dot centre, across the gap between rows. */
  bottom: calc(-1 * (${space[3]} + ${DOT_Y}));
`

const Row = styled.li`
  position: relative;
  display: grid;
  min-width: 0;
  padding-left: ${space[12]};
  &[data-line='solid']::after {
    ${line}
    background: ${color.lineStrong};
  }
  &[data-line='dashed']::after {
    ${line}
    background: repeating-linear-gradient(
      to bottom,
      ${color.lineStrong} 0 ${space[2]},
      transparent ${space[2]} ${space[4]}
    );
  }
  &[data-rail='action']::before {
    content: '';
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    left: calc(${RAIL_X} - ${DOT} / 2);
    top: calc(${DOT_Y} - ${DOT} / 2);
    width: ${DOT};
    height: ${DOT};
    border-radius: 50%;
    border: ${space[1]} solid ${color.muted};
    background: ${color.surface};
  }
  &[data-now]::before {
    left: calc(${RAIL_X} - ${NOW_DOT} / 2);
    top: calc(${DOT_Y} - ${NOW_DOT} / 2);
    width: ${NOW_DOT};
    height: ${NOW_DOT};
    border-color: ${color.accent};
    background: ${color.accent};
    ${motion.nowRing}
  }
`
