import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, font, space, type } from '../../theme/generated/tokens'
import { formatCount, media } from './media'

export type ChangeItem = { id: string; label: string; href?: string; pill?: ReactNode }

export type ChangeSection = { title: string; count: number; items: ChangeItem[] }

/** What will change, grouped by record type; rows link back to Review. */
export function ChangeSummary({ sections }: { sections: ChangeSection[] }) {
  return (
    <div>
      {sections.map((section) => (
        <Section key={section.title} aria-label={`${section.title}, ${section.count}`}>
          <h3>
            {section.title} <Total>{formatCount(section.count)}</Total>
          </h3>
          <ul>
            {section.items.map((item) => (
              <li key={item.id}>
                {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
                {item.pill}
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}

const Section = styled.section`
  padding: ${space[3]} ${space[4]};
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: ${space[2]};
    margin: 0;
    ${type.h3}
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: ${space[2]} 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: ${space[2]};
    overflow-wrap: anywhere;
  }
  a {
    color: ${color.accent};
    ${media.compact} {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
  }
`

const Total = styled.span`
  font-family: ${font.mono};
  font-size: 13px;
  font-weight: 400;
  color: ${color.muted};
`
