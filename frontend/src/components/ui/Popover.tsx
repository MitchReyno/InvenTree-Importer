import * as RadixPopover from '@radix-ui/react-popover'
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, shadow, space, zIndex } from '#/theme/generated/tokens'
import { motion } from './motion'

type Align = 'start' | 'center' | 'end'

/** Matches the panel's collision padding: the gap kept between a popover and the window edge. */
const EDGE_GAP_PX = 12

/**
 * The alignment a popover opens with. It keeps the preferred one while that side of the trigger
 * has room for the panel, and otherwise opens toward whichever side has more room, rather than
 * letting the window edge push the panel away from its trigger. Positioning then caps the panel
 * to the room on the chosen side.
 */
export function chooseAlign(
  preferred: Align,
  trigger: { left: number; right: number },
  panelWidth: number,
  viewportWidth: number,
): Align {
  if (preferred === 'center') {
    return preferred
  }

  const roomTowardLeft = trigger.right - EDGE_GAP_PX
  const roomTowardRight = viewportWidth - trigger.left - EDGE_GAP_PX
  const preferredRoom = preferred === 'end' ? roomTowardLeft : roomTowardRight
  const otherRoom = preferred === 'end' ? roomTowardRight : roomTowardLeft

  if (panelWidth > preferredRoom && otherRoom > preferredRoom) {
    return preferred === 'end' ? 'start' : 'end'
  }

  return preferred
}

/**
 * The widest a panel can be at an alignment without leaving the window, so positioning never has
 * to slide it away from its trigger. A centred panel is left to positioning.
 */
export function roomFor(
  align: Align,
  trigger: { left: number; right: number },
  viewportWidth: number,
): number | undefined {
  if (align === 'center') {
    return undefined
  }

  const room =
    align === 'end' ? trigger.right - EDGE_GAP_PX : viewportWidth - trigger.left - EDGE_GAP_PX

  return Math.max(0, Math.floor(room))
}

type Placement = { align: Align; room: number | undefined }

type PopoverProps = {
  /** The popover's accessible name. */
  label: string
  /** The control that opens it; it receives the open state and aria attributes. */
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: Align
  /** A set width for panels whose content needs one; the window's width still caps it. */
  width?: string
  /** `menu` when the panel holds menu items; otherwise a non-modal dialog. */
  role?: 'dialog' | 'menu'
  /** Lets the content place focus itself when it opens. */
  onOpenAutoFocus?: (event: Event) => void
  /** Lets the opener keep focus where a chosen action put it when the panel closes. */
  onCloseAutoFocus?: (event: Event) => void
  children: ReactNode
}

/** A floating panel opened from a control; Escape and an outside click close it. */
export function Popover({
  label,
  trigger,
  open,
  onOpenChange,
  align = 'end',
  width,
  role = 'dialog',
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
}: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  // The panel's own width is read as it attaches, before any cap, so the choice compares the width
  // it wants with the room each side has; the panel is then capped to the chosen side's room. While
  // it is open, a window resize or a change in the trigger's size chooses again.
  const measurePanel = useCallback(
    (panel: HTMLDivElement | null) => {
      if (!panel) {
        setPlacement(null)

        return
      }

      const wantedWidth = panel.offsetWidth

      function choose(): void {
        const triggerElement = triggerRef.current
        if (!triggerElement) {
          return
        }

        const viewportWidth = document.documentElement.clientWidth
        const triggerBox = triggerElement.getBoundingClientRect()
        const chosen = chooseAlign(align, triggerBox, wantedWidth, viewportWidth)
        setPlacement({ align: chosen, room: roomFor(chosen, triggerBox, viewportWidth) })
      }

      choose()
      window.addEventListener('resize', choose)
      const triggerObserver =
        typeof ResizeObserver === 'function' && triggerRef.current
          ? new ResizeObserver(choose)
          : null
      if (triggerRef.current) {
        triggerObserver?.observe(triggerRef.current)
      }

      return () => {
        window.removeEventListener('resize', choose)
        triggerObserver?.disconnect()
        setPlacement(null)
      }
    },
    [align],
  )

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixPopover.Trigger ref={triggerRef} asChild>
        {trigger}
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <Surface
          ref={measurePanel}
          align={placement?.align ?? align}
          sideOffset={8}
          collisionPadding={EDGE_GAP_PX}
          role={role}
          aria-label={label}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          style={{ width, maxWidth: placement?.room }}
        >
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
