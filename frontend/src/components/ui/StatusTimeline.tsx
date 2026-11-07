import styled from 'styled-components'
import { color, radius, space, typeVar, zIndex } from '../../theme/generated/tokens'

export type TimelineEntry = { text: string; time: string; current?: boolean }

/** Session status lines, newest last. */
export function StatusTimeline({ label, entries }: { label: string; entries: TimelineEntry[] }) {
  return (
    <List aria-label={label}>
      {entries.map((entry, index) => (
        <li
          key={`${index}-${entry.time}`}
          aria-current={entry.current ? 'step' : undefined}
          data-current={entry.current ?? false}
        >
          <Marker aria-hidden="true" />
          <span>{entry.text}</span>
          <time>{entry.time}</time>
        </li>
      ))}
    </List>
  )
}

const List = styled.ol`
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    position: relative;
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: ${space[5]};
    padding: 5px 0;
  }
  li::before {
    content: '';
    position: absolute;
    left: 7px;
    top: ${space[7]};
    bottom: -6px;
    width: 2px;
    background: ${color.line};
  }
  li:last-child::before {
    display: none;
  }
  li[data-current='true'] > span:nth-child(2) {
    font-weight: ${typeVar.bodyStrong.weight};
  }
  li[data-current='true'] > span:first-child {
    background: ${color.accent};
    box-shadow: 0 0 0 4px ${color.accentWeak};
  }
  time {
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: ${color.muted};
  }
`

const Marker = styled.span`
  position: relative;
  z-index: ${zIndex.raised};
  width: 10px;
  height: 10px;
  margin: 0 3px;
  border-radius: ${radius.round};
  background: ${color.lineStrong};
`
