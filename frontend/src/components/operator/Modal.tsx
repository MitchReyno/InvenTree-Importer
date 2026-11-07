import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import { HeadingRow, Subheading } from '../ui/primitives'
import { Button } from '../ui/Button'

interface Props {
  title: string
  onClose: () => void
  /** Pending or uncertain work keeps the dialog open until explicit resolution. */
  closeDisabled?: boolean
  children: ReactNode
}

/** Native modal dialog: the platform traps focus; we restore it to the opener on close. */
export function Modal({ title, onClose, closeDisabled = false, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const opener = document.activeElement
    const element = dialog.current
    if (element && !element.open) {
      if (typeof element.showModal === 'function') {
        element.showModal()
      } else {
        element.open = true
      }
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus()
      }
    }
  }, [])

  return createPortal(
    <Dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) {
          onClose()
        }
      }}
    >
      <HeadingRow>
        <Subheading>{title}</Subheading>
        <Button type="button" disabled={closeDisabled} onClick={onClose}>
          Close
        </Button>
      </HeadingRow>
      {children}
    </Dialog>,
    document.body,
  )
}

const Dialog = styled.dialog`
  width: min(960px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 20px;
  border: 1px solid ${color.line};
  border-radius: 8px;
  color: ${color.fg};
  background: ${color.surface};
  a {
    color: ${color.accent};
  }
  &::backdrop {
    background: ${color.overlay};
  }
`
