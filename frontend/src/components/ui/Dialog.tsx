import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled, { css } from 'styled-components'
import { color, radius, shadow, space, type } from '#/theme/generated/tokens'
import { Button } from './Button'
import { motion } from './motion'

type DialogProps = {
  /** Names the dialog; it may hold an `AiMark`, which stays out of the accessible name. */
  title: ReactNode
  onClose: () => void
  /** Pending or uncertain work keeps the dialog open until it is resolved. */
  closeDisabled?: boolean
  /** "side" docks the dialog to the right edge at full height, as a drawer. */
  placement?: 'center' | 'side'
  children: ReactNode
}

/** A modal step: the native dialog keeps focus inside, and focus returns to the opener on close. */
export function Dialog({
  title,
  onClose,
  closeDisabled = false,
  placement = 'center',
  children,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  // The element that had focus before the dialog opened, which gets it back on close.
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = dialog.current
    const active = document.activeElement
    // Keeps the recorded opener if focus is already inside the dialog.
    if (active instanceof HTMLElement && !element?.contains(active)) {
      opener.current = active
    }
    if (element && !element.open) {
      if (typeof element.showModal === 'function') {
        element.showModal()
      } else {
        element.open = true
      }
    }
    return () => {
      // The opener is inert while the modal is open, so the dialog closes before focus returns.
      if (element?.open) {
        if (typeof element.close === 'function') {
          element.close()
        } else {
          element.open = false
        }
      }
      if (opener.current?.isConnected) {
        opener.current.focus()
      }
    }
  }, [])

  return createPortal(
    <DialogSurface
      ref={dialog}
      data-placement={placement}
      $side={placement === 'side'}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) {
          onClose()
        }
      }}
    >
      <TitleRow>
        {/* Focusable by script, so focus can land on the title when content it held leaves. */}
        <Title id={titleId} tabIndex={-1}>
          {title}
        </Title>
        <Button size="sm" disabled={closeDisabled} onClick={onClose}>
          Close
        </Button>
      </TitleRow>
      {children}
    </DialogSurface>,
    document.body,
  )
}

/** The modal surface, for dialogs that manage their own native lifecycle; `$wide` fits editors. */
export const DialogSurface = styled.dialog<{ $wide?: boolean; $side?: boolean }>`
  width: min(${({ $wide }) => ($wide ? '1400px' : '960px')}, calc(100vw - 2 * ${space[8]}));
  max-height: calc(100dvh - 2 * ${space[8]});
  overflow: auto;
  padding: ${space[10]};
  border: 1px solid ${color.line};
  border-radius: ${radius.dialog};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  &[open] {
    ${motion.enter}
  }
  a {
    color: ${color.accent};
  }
  &::backdrop {
    background: ${color.overlay};
  }
  ${({ $side }) =>
    $side &&
    css`
      width: min(420px, 100vw);
      height: 100dvh;
      max-height: 100dvh;
      margin: 0 0 0 auto;
      border-width: 0 0 0 1px;
      border-radius: 0;
    `}
`

const TitleRow = styled.div`
  display: flex;
  gap: ${space[6]};
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${space[6]};
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`
