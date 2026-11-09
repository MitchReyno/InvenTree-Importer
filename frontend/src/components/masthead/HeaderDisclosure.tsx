import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { media, hoverTransition, Popover } from '#/components/ui'

type Variant = 'activity' | 'connection'

interface HeaderDisclosureProps {
  label: string
  title: string
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The design system's pill: the taller activity pill or the compact connection pill. */
  variant: Variant
  /** Accent pill while work is under way; an idle activity pill is plain. */
  active?: boolean
  describedBy?: string
  children: ReactNode
}

/** A masthead status pill that opens its details; the dialog is named by `title`. */
export function HeaderDisclosure({
  label,
  title,
  trigger,
  open,
  onOpenChange,
  variant,
  active = false,
  describedBy,
  children,
}: HeaderDisclosureProps) {
  return (
    <Popover
      label={title}
      width={`min(360px, calc(100vw - ${space[12]}))`}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Trigger
          type="button"
          aria-label={label}
          aria-describedby={describedBy}
          data-active={active}
          $variant={variant}
        >
          {trigger}
        </Trigger>
      }
    >
      {children}
    </Popover>
  )
}

const variants = {
  activity: css`
    gap: ${space[4]};
    padding: ${space[2]} ${space[5]} ${space[2]} ${space[4]};
    color: ${color.fg};
  `,
  connection: css`
    gap: ${space[3]};
    padding: ${space[2]} ${space[5]};
    color: ${color.muted};
    font-size: ${typeVar.small.size};
  `,
}

const Trigger = styled.button<{ $variant: Variant }>`
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  cursor: pointer;
  ${hoverTransition}
  ${({ $variant }) => variants[$variant]}
  &[data-active='true'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  &:hover,
  &[data-state='open'] {
    border-color: ${color.accent};
  }
  ${media.compact} {
    justify-content: center;
    min-width: ${size.touch};
    min-height: ${size.touch};
    padding-inline: ${space[2]};
  }
`
