import { useId, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styled, { keyframes } from 'styled-components'
import { color, radius, shadow, space, type } from '../../theme/generated/tokens'
import { media } from '../ui/media'

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
  const titleId = useId()
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Trigger asChild>
        <Trigger type="button" aria-label={label} data-active={active}>
          {trigger}
        </Trigger>
      </Popover.Trigger>
      <Popover.Portal>
        <Content align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
          <TitleRow>
            <Title id={titleId}>{title}</Title>
            <Popover.Close asChild>
              <Close type="button" aria-label={`Close ${title}`}>
                Close
              </Close>
            </Popover.Close>
          </TitleRow>
          {children}
        </Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const open = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
`

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  max-width: 100%;
  min-width: 0;
  padding: 3px ${space['2-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  font-size: 12.5px;
  cursor: pointer;
  &[data-active='true'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  &:hover,
  &[data-state='open'] {
    border-color: ${color.accent};
  }
  ${media.compact} {
    min-width: 44px;
    min-height: 44px;
  }
`

const Content = styled(Popover.Content)`
  z-index: 1000;
  width: min(360px, calc(100vw - 24px));
  max-width: var(--radix-popover-content-available-width);
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  overscroll-behavior: contain;
  padding: ${space['3-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  overflow-wrap: anywhere;
  animation: ${open} 120ms ease-out;
  ${media.reducedMotion} {
    animation: none;
  }
`

const TitleRow = styled.div`
  display: flex;
  gap: ${space[3]};
  align-items: center;
  justify-content: space-between;
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`

const Close = styled.button`
  min-height: 32px;
  padding: ${space['1-5']} ${space['2-5']};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
  color: ${color.fg};
  cursor: pointer;
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: 44px;
  }
`
