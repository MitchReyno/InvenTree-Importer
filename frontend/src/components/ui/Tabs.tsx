import styled, { css } from 'styled-components'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import { formatCount, media } from './media'
import { Badge, Count, type CountTone } from './Pill'
import { Spinner } from './Loading'
import { hoverTransition } from './motion'
import { visuallyHidden } from './VisuallyHidden'

/** `short` replaces the words at phone width, where the row has room only for numbers. */
export type TabBadge = { label: string; short?: string; tone: 'warn' | 'bad' | 'ok' }

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
  /** A step's attempts: a tick when all are ready, otherwise "7 of 12". */
  progress?: { ready: number; of: number }
}

type TabsProps = { label: string; items: TabItem[]; current: string }

function accessibleName(item: TabItem) {
  // The spinner is decorative, so its meaning is read here.
  const parts = [item.label, ...(item.spinner ? ['running'] : [])]
  if (item.count !== undefined) {
    parts.push([formatCount(item.count), item.countLabel].filter(Boolean).join(' '))
  }
  if (item.progress) {
    const { ready, of } = item.progress
    parts.push(ready === of ? 'done' : `${ready} of ${of} ready`)
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
            {item.progress && item.progress.ready === item.progress.of && (
              <Done aria-hidden="true">✓</Done>
            )}
            <TabLabel>{item.label}</TabLabel>
            {item.count !== undefined && <Count value={item.count} tone={item.countTone} />}
            {item.progress && item.progress.ready < item.progress.of && (
              <Badge tone="default">
                {item.progress.ready} of {item.progress.of}
              </Badge>
            )}
            {item.badge && (
              <Badge tone={BADGE_TONE[item.badge.tone]}>
                {item.badge.short ? (
                  <>
                    <Words>{item.badge.label}</Words>
                    <Short aria-hidden="true">{item.badge.short}</Short>
                  </>
                ) : (
                  item.badge.label
                )}
              </Badge>
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

/** The second tab row; each item can carry a count, an attention badge and a spinner. */
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

/** Below bp-compact a badge shows only its number; its words are still read. */
const Words = styled.span`
  ${media.compact} {
    ${visuallyHidden}
  }
`

const Short = styled.span`
  display: none;
  ${media.compact} {
    display: inline;
  }
`
