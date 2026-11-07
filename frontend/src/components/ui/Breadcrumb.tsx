import { Fragment } from 'react'
import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'

export type BreadcrumbItem = { label: string; href?: string }

/** Masthead only. The last item ellipsises first and never pushes the status controls out. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <Trail aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        return (
          <Fragment key={`${index}-${item.label}`}>
            {index > 0 && <Separator aria-hidden="true">/</Separator>}
            {isLast || !item.href ? (
              <Current aria-current={isLast ? 'page' : undefined} title={item.label}>
                {item.label}
              </Current>
            ) : (
              <Crumb href={item.href}>{item.label}</Crumb>
            )}
          </Fragment>
        )
      })}
    </Trail>
  )
}

const Trail = styled.nav`
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  white-space: nowrap;
  gap: ${space[3]};
  min-width: 0;
  color: ${color.muted};
`

const Crumb = styled.a`
  flex: none;
  color: ${color.accent};
`

const Separator = styled.span`
  flex: none;
`

const Current = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${color.fg};
`
