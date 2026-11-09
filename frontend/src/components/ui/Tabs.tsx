import styled, { css } from 'styled-components'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import { media } from './media'
import { Badge, type CountTone } from './Pill'
import { Spinner } from './Loading'
import { hoverTransition } from './motion'

/** A tab's one count: the number or progress it shows, its words when read, and its tone. */
export type TabItemCount = { value: string; label: string; tone: CountTone }

export type TabItem = {
  id: string
  label: string
  href: string
  /** At most one count per tab: the thing to act on, otherwise the total or progress. */
  count?: TabItemCount
  /** A step's status icon: a spinner while running, a tick once done. */
  status?: 'running' | 'done'
  disabled?: boolean
}

type TabsProps = { label: string; items: TabItem[]; current: string }

function accessibleName(item: TabItem) {
  // The icons are decorative, so their meaning is read here.
  const parts = [item.label]
  if (item.status) {
    parts.push(item.status)
  }
  if (item.count) {
    parts.push(item.count.label)
  }

  return parts.join(', ')
}

function TabLinks({
  label,
  items,
  current,
  level,
}: TabsProps & { level: 'primary' | 'secondary' }) {
  return (
    <Row aria-label={label}>
      {items.map((item) => {
        const name = accessibleName(item)
        const isCurrent = item.id === current

        return (
          <TabLink
            key={item.id}
            $level={level}
            href={item.disabled ? undefined : item.href}
            aria-current={isCurrent ? 'page' : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={item.disabled ? -1 : undefined}
            aria-label={name === item.label ? undefined : name}
            title={item.label}
          >
            {item.status === 'running' && <Spinner />}
            {item.status === 'done' && <Done aria-hidden="true">✓</Done>}
            <TabLabel>{item.label}</TabLabel>
            {item.count && (
              <span data-tone={item.count.tone}>
                <Badge tone={item.count.tone}>{item.count.value}</Badge>
              </span>
            )}
          </TabLink>
        )
      })}
    </Row>
  )
}

/** Route links, not an ARIA tablist, so each tab is a deep link. */
export function Tabs(props: TabsProps) {
  return <TabLinks {...props} level="primary" />
}

/** The second tab row; each item can carry one count and a status icon. */
export function SubTabs(props: TabsProps) {
  return <TabLinks {...props} level="secondary" />
}

const Row = styled.nav`
  display: flex;
  gap: ${space[1]};
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid ${color.line};
  &::-webkit-scrollbar {
    display: none;
  }
`

const levels = {
  primary: css`
    padding: 9px ${space[6]} ${space[5]};
    gap: ${space[2]};
    /* Four tabs and their numbers fit one row at phone width. */
    ${media.compact} {
      padding-inline: ${space[4]};
    }
  `,
  secondary: css`
    padding: calc(${space[4]} - 1px) ${space[5]} calc(${space[5]} - 1px);
    gap: ${space[3]};
    font-size: 13px;
    &:hover {
      background: ${color.surface2};
    }
    &[aria-current='page'] {
      font-weight: ${typeVar.bodyStrong.weight};
    }
  `,
}

const TabLink = styled.a<{ $level: 'primary' | 'secondary' }>`
  display: inline-flex;
  align-items: center;
  max-width: 260px;
  border-bottom: 2px solid transparent;
  color: ${color.muted};
  font-weight: ${typeVar.buttonLg.weight};
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  ${({ $level }) => levels[$level]}
  ${hoverTransition}
  &:hover {
    color: ${color.fg};
  }
  &[aria-current='page'] {
    color: ${color.fg};
    border-bottom-color: ${color.accent};
  }
  /* The row scrolls and would clip an outside ring, so focus is drawn inside the link. */
  &:focus-visible {
    outline-offset: -2px;
  }
  &[aria-disabled='true'] {
    opacity: 0.45;
    cursor: not-allowed;
  }
  ${media.compact} {
    min-height: ${size.touch};
    /* An explicit minimum would otherwise let the tab shrink below its label. */
    flex-shrink: 0;
    min-width: ${size.touch};
    justify-content: center;
  }
`

const TabLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`

const Done = styled.span`
  color: ${color.ok};
  font-weight: ${typeVar.pill.weight};
`
