import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { hoverTransition } from '../ui/motion'
import { Popover } from '../ui/Popover'

interface HeaderDisclosureProps {
  label: string
  title: string
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accent pill while work is running. */
  active?: boolean
  children: ReactNode
}

export function HeaderDisclosure({
  label,
  title,
  trigger,
  open,
  onOpenChange,
  active = false,
  children,
}: HeaderDisclosureProps) {
  return (
    <Popover
      label={title}
      width={`min(360px, calc(100vw - ${space[12]}))`}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Trigger type="button" aria-label={label} data-active={active}>
          {trigger}
        </Trigger>
      }
    >
      <Body>
        <TitleRow>
          <Title>{title}</Title>
          <Button aria-label={`Close ${title}`} onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </TitleRow>
        {children}
      </Body>
    </Popover>
  )
}

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  min-height: ${size.control};
  max-width: 100%;
  min-width: 0;
  padding: 3px ${space[5]};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  font-size: ${typeVar.small.size};
  cursor: pointer;
  ${hoverTransition}
  &[data-active='true'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  &:hover,
  &[data-state='open'] {
    border-color: ${color.accent};
  }
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

const Body = styled.div`
  padding: ${space[5]};
`

const TitleRow = styled.div`
  display: flex;
  gap: ${space[6]};
  align-items: center;
  justify-content: space-between;
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`
