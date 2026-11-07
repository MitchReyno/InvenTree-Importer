import styled, { css } from 'styled-components'
import { color, radius, size, space, typeVar } from '../../theme/generated/tokens'
import { media } from './media'
import { hoverTransition } from './motion'

export type RecordState = 'exists' | 'new' | 'update' | 'choose' | 'none'

export type RecordLink = { kind: string; label: string; state: RecordState; href: string }

const STATE_TEXT: Record<RecordState, { glyph: string; word: string }> = {
  exists: { glyph: '✓', word: 'exists' },
  new: { glyph: '+', word: 'new' },
  update: { glyph: '↻', word: 'update' },
  choose: { glyph: '?', word: 'choose' },
  none: { glyph: '–', word: 'none' },
}

/** The InvenTree records a lot touches, in dependency order. */
export function RecordChain({ links }: { links: RecordLink[] }) {
  return (
    <Chain aria-label="Record chain">
      {links.map((link, index) => {
        const state = STATE_TEXT[link.state]

        return (
          <Item key={`${link.kind}-${link.label}`}>
            {index > 0 && <Arrow aria-hidden="true">→</Arrow>}
            <Link
              href={link.href}
              $state={link.state}
              aria-label={`${link.kind} ${link.label}: ${state.word}`}
            >
              <Kind>{link.kind}</Kind>
              <Status>
                <span aria-hidden="true">{state.glyph}</span>
                {link.label}
              </Status>
            </Link>
          </Item>
        )
      })}
    </Chain>
  )
}

const states = {
  exists: css`
    --chain-ink: ${color.ok};
  `,
  new: css`
    --chain-ink: ${color.info};
    border-style: dashed;
    border-color: ${color.info};
  `,
  update: css`
    --chain-ink: ${color.accent};
    border-color: ${color.accent};
  `,
  choose: css`
    --chain-ink: ${color.warn};
    border-color: ${color.warn};
  `,
  none: css`
    --chain-ink: ${color.muted};
  `,
}

// Scrolls inside itself when one record's label is wider than the page.
const Chain = styled.ol`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
  max-width: 100%;
  margin: -4px;
  /* Room for focus rings inside the scroll container. */
  padding: ${space[2]};
  overflow-x: auto;
  list-style: none;
`

const Item = styled.li`
  display: flex;
  align-items: center;
  gap: ${space[2]};
`

const Arrow = styled.span`
  font-size: 12px;
  color: ${color.muted};
`

const Link = styled.a<{ $state: RecordState }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 3px calc(${space[4]} - 1px);
  border: 1px solid ${color.line};
  border-radius: ${radius.input};
  background: ${color.surface};
  color: ${color.fg};
  line-height: 1.3;
  text-decoration: none;
  ${({ $state }) => states[$state]}
  ${hoverTransition}
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    justify-content: center;
    min-height: ${size.touch};
    min-width: ${size.touch};
  }
`

const Kind = styled.span`
  font-size: 10.5px;
  font-weight: ${typeVar.label.weight};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${color.muted};
`

const Status = styled.span`
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: ${typeVar.pill.size};
  font-weight: ${typeVar.pill.weight};
  white-space: nowrap;
  color: var(--chain-ink);
`
