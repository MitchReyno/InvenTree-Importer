import * as RadixPopover from '@radix-ui/react-popover'
import type { ReactElement, ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, shadow, space, zIndex } from '../../theme/generated/tokens'
import { motion } from './motion'

type PopoverProps = {
  /** The popover's accessible name. */
  label: string
  /** The control that opens it; it receives the open state and aria attributes. */
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  children: ReactNode
}

/** A floating panel opened from a control; Escape and an outside click close it. */
export function Popover({
  label,
  trigger,
  open,
  onOpenChange,
  align = 'end',
  children,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <Surface align={align} sideOffset={8} collisionPadding={12} aria-label={label}>
          {children}
        </Surface>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

const Surface = styled(RadixPopover.Content)`
  z-index: ${zIndex.popover};
  max-width: var(--radix-popover-content-available-width);
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  overscroll-behavior: contain;
  padding: ${space[2]};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  overflow-wrap: anywhere;
  ${motion.popover}
`
