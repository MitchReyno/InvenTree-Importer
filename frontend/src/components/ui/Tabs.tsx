import styled, { css } from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import { formatCount, media } from './media'
import { Badge, Count, type CountTone } from './Pill'
import { Spinner } from './Progress'

export type TabBadge = { label: string; tone: 'warn' | 'bad' | 'ok' }

export type TabItem = {
  id: string
  label: string
  href: string
  count?: number
  countTone?: CountTone
  /** Words after the count in the accessible name ("8 to check"). */
  countLabel?: string
  badge?: TabBadge
  disabled?: boolean
  spinner?: boolean
}

type TabsProps = { label: string; items: TabItem[]; current: string }

function accessibleName(item: TabItem) {
  const parts = [item.label]
  if (item.count !== undefined) {
    parts.push([formatCount(item.count), item.countLabel].filter(Boolean).join(' '))
  }
  if (item.badge) {
    parts.push(item.badge.label)
  }

  return parts.join(', ')
}

const BADGE_TONE: Record<TabBadge['tone'], CountTone> = { warn: 'warn', bad: 'bad', ok: 'ok' }

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
            {item.spinner && <Spinner />}
            <TabLabel>{item.label}</TabLabel>
            {item.count !== undefined && <Count value={item.count} tone={item.countTone} />}
            {item.badge && <Badge tone={BADGE_TONE[item.badge.tone]}>{item.badge.label}</Badge>}
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

/** The second tab row; each item can carry a count, an attention badge and a spinner. */
export function SubTabs(props: TabsProps) {
  return <TabLinks {...props} level="secondary" />
}

const Row = styled.nav`
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid ${color.line};
  &::-webkit-scrollbar {
    display: none;
  }
`

const levels = {
  primary: css`
    padding: 9px ${space[3]} ${space['2-5']};
    gap: ${space[1]};
  `,
  secondary: css`
    padding: 7px ${space['2-5']} 9px;
    gap: ${space['1-5']};
    font-size: 13px;
  `,
}

const TabLink = styled.a<{ $level: 'primary' | 'secondary' }>`
  display: inline-flex;
  align-items: center;
  max-width: 260px;
  border-bottom: 2px solid transparent;
  color: ${color.muted};
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  ${({ $level }) => levels[$level]}
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
    min-height: 44px;
  }
`

const TabLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`
