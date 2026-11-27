import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import { space, type } from '#/theme/generated/tokens'
import { Button } from './Button'
import { ModalFrame, ModalTitle } from './ModalFrame'

type DialogProps = {
  /** Names the dialog; it may hold an `AiMark`, which stays out of the accessible name. */
  title: ReactNode
  onClose: () => void
  /** Pending or uncertain work keeps the dialog open until it is resolved. */
  closeDisabled?: boolean
  /** "side" docks the dialog to the right edge at full height, as a drawer. */
  placement?: 'center' | 'side'
  /**
   * Where focus goes on close when the opener can't take it back: focus was on the page itself
   * when the dialog opened, such as a drawer restored after a remount, or the opener was removed
   * or disabled before the dialog closed. Failing both, a modal still open beneath takes it.
   */
  returnFocus?: () => HTMLElement | null
  children: ReactNode
}

/**
 * A modal step: focus stays inside, Esc, Close or a click on the dimmed backdrop closes it, and
 * focus returns to the opener on close.
 */
export function Dialog({
  title,
  onClose,
  closeDisabled = false,
  placement = 'center',
  returnFocus,
  children,
}: DialogProps) {
  const titleId = useId()

  return (
    <ModalFrame
      onClose={onClose}
      closeDisabled={closeDisabled}
      placement={placement}
      returnFocus={returnFocus}
      labelledBy={titleId}
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
    </ModalFrame>
  )
}

const TitleRow = styled.div`
  display: flex;
  gap: ${space[6]};
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${space[6]};
`

const Title = styled(ModalTitle)`
  margin: 0;
  ${type.h2}
`
