import { useId, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styled from 'styled-components'
import { color, shadow } from '../../theme/generated/tokens'

interface HeaderDisclosureProps {
  label: string
  title: string
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function HeaderDisclosure({
  label,
  title,
  trigger,
  open,
  onOpenChange,
  children,
}: HeaderDisclosureProps) {
  const titleId = useId()
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Trigger asChild>
        <Trigger type="button" aria-label={label}>
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

const Trigger = styled.button`
  min-height: 2rem;
  max-width: 100%;
  border: 1px solid ${color.lineStrong};
  border-radius: 1rem;
  padding: 8px 12px;
  color: ${color.fg};
  background: ${color.surface};
  cursor: pointer;
  &[data-state='open'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  &:hover {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
`

const Content = styled(Popover.Content)`
  z-index: 1000;
  width: min(360px, calc(100vw - 24px));
  max-width: var(--radix-popover-content-available-width);
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid ${color.lineStrong};
  border-radius: 10px;
  padding: 14px;
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  font-size: 14px;
  overflow-wrap: anywhere;
`

const TitleRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
`

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
`

const Close = styled.button`
  min-height: 44px;
  border: 1px solid ${color.lineStrong};
  border-radius: 6px;
  padding: 6px 10px;
  background: ${color.surface2};
  color: ${color.fg};
  cursor: pointer;
`
