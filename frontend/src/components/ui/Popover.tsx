import * as RadixPopover from '@radix-ui/react-popover'
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, shadow, space, zIndex } from '#/theme/generated/tokens'
import { useModalContainer } from '#/context/ModalContainerContext'
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
  // The choice compares the width the panel wants with the room each side of the trigger has, and
  // the panel is then capped to the chosen side's room. While it is open, it chooses again whenever
  // the trigger moves or resizes, or the window changes width; the wanted width is read with the cap
  // lifted, so a responsive width is followed too.
  const measurePanel = useCallback(
    (panel: HTMLDivElement | null) => {
      if (!panel) {
        setPlacement(null)

        return
      }

      let lastKey = ''
      let frame = 0

      function wantedWidth(target: HTMLDivElement): number {
        const cap = target.style.maxWidth
        target.style.maxWidth = 'none'
        const width = target.offsetWidth
        target.style.maxWidth = cap

        return width
      }

      function choose(): void {
        const triggerElement = triggerRef.current
        if (!triggerElement || !panel) {
          return
        }

        const viewportWidth = document.documentElement.clientWidth
        const triggerBox = triggerElement.getBoundingClientRect()
        const chosen = chooseAlign(align, triggerBox, wantedWidth(panel), viewportWidth)
        setPlacement({ align: chosen, room: roomFor(chosen, triggerBox, viewportWidth) })
      }

      // Layout shifts can move the trigger without resizing it, so its place is checked each frame.
      function watch(): void {
        const triggerElement = triggerRef.current
        if (triggerElement) {
          const box = triggerElement.getBoundingClientRect()
          const key = `${Math.round(box.left)}:${Math.round(box.right)}:${document.documentElement.clientWidth}`
          if (key !== lastKey) {
            lastKey = key
            choose()
          }
        }

        frame = requestAnimationFrame(watch)
      }

      watch()

      return () => {
        cancelAnimationFrame(frame)
        setPlacement(null)
      }
    },
    [align],
  )

  // Inside a modal, the panel portals into it, so it stacks above the modal.
  const modal = useModalContainer()

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixPopover.Trigger ref={triggerRef} asChild>
        {trigger}
      </RadixPopover.Trigger>
      <RadixPopover.Portal container={modal}>
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
