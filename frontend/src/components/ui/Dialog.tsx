import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { color, radius, shadow, space, type } from '../../theme/generated/tokens'
import { Button } from './Button'

type DialogProps = {
  title: string
  onClose: () => void
  /** Pending or uncertain work keeps the dialog open until it is resolved. */
  closeDisabled?: boolean
  children: ReactNode
}

/** A modal step: the native dialog keeps focus inside, and focus returns to the opener on close. */
export function Dialog({ title, onClose, closeDisabled = false, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

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
    <Surface
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) {
          onClose()
        }
      }}
    >
      <TitleRow>
        <Title id={titleId}>{title}</Title>
        <Button size="sm" disabled={closeDisabled} onClick={onClose}>
          Close
        </Button>
      </TitleRow>
      {children}
    </Surface>,
    document.body,
  )
}

const Surface = styled.dialog`
  width: min(960px, calc(100vw - 2 * ${space[8]}));
  max-height: calc(100dvh - 2 * ${space[8]});
  overflow: auto;
  padding: ${space[10]};
  border: 1px solid ${color.line};
  border-radius: ${radius.dialog};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  a {
    color: ${color.accent};
  }
  &::backdrop {
    background: ${color.overlay};
  }
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
