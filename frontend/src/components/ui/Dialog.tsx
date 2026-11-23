import * as RadixDialog from '@radix-ui/react-dialog'
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, shadow, space, type, zIndex } from '#/theme/generated/tokens'
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
  /**
   * Where focus goes on close when the opener can't take it back: focus was on the page itself
   * when the dialog opened, such as a drawer restored after a remount, or the opener was removed
   * before the dialog closed. A connected opener always takes focus back instead.
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
  return (
    <ModalFrame
      onClose={onClose}
      closeDisabled={closeDisabled}
      placement={placement}
      returnFocus={returnFocus}
    >
      <TitleRow>
        {/* Focusable by script, so focus can land on the title when content it held leaves. */}
        <Title tabIndex={-1}>{title}</Title>
        <Button size="sm" disabled={closeDisabled} onClick={onClose}>
          Close
        </Button>
      </TitleRow>
      {children}
    </ModalFrame>
  )
}

type ModalFrameProps = {
  /** Called for Esc (unless `closeOnEscape` is false) and a backdrop click. */
  onClose: () => void
  /** Esc and a backdrop click leave the dialog open while set. */
  closeDisabled?: boolean
  /** False for an editor whose Esc must not discard its work. */
  closeOnEscape?: boolean
  placement?: 'center' | 'side'
  /** A wider surface, for editors. */
  wide?: boolean
  returnFocus?: () => HTMLElement | null
  /** Must include a `ModalTitle`, which names the dialog. */
  children: ReactNode
}

/**
 * The modal layer behind every dialog: backdrop, focus trap, dismissal and focus return.
 * `Dialog` adds its title row; editors with their own heading use it directly.
 */
export function ModalFrame({
  onClose,
  closeDisabled = false,
  closeOnEscape = true,
  placement = 'center',
  wide = false,
  returnFocus,
  children,
}: ModalFrameProps) {
  const surface = useRef<HTMLDivElement | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const mounted = useRef(false)
  const fallback = useRef(returnFocus)
  useLayoutEffect(() => {
    fallback.current = returnFocus
  })

  // Runs before Radix moves focus into the dialog, so the opener is still focused.
  useLayoutEffect(() => {
    mounted.current = true
    const active = document.activeElement
    // Keeps the recorded opener when a StrictMode replay finds focus already inside.
    if (active instanceof HTMLElement && !surface.current?.contains(active)) {
      opener.current = active
    }
    return () => {
      mounted.current = false
    }
  }, [])

  // Focus settles as the surface mounts, before its content's Effects run, as `showModal` did;
  // Radix then finds focus inside and leaves it.
  const attachSurface = useCallback((element: HTMLDivElement | null) => {
    surface.current = element
    if (element && !element.contains(document.activeElement)) {
      element.querySelector<HTMLElement>(TABBABLE)?.focus()
    }
  }, [])

  // Radix calls this just after the dialog unmounts. Focus the owner moved elsewhere stays put.
  function restoreFocus(event: Event) {
    event.preventDefault()
    if (mounted.current) {
      return
    }
    const current = document.activeElement
    if (current && current !== document.body) {
      return
    }
    const back = opener.current
    if (back?.isConnected && back !== document.body) {
      back.focus()
    } else {
      fallback.current?.()?.focus()
    }
  }

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <RadixDialog.Portal>
        <Backdrop />
        <DialogSurface
          ref={attachSurface}
          data-placement={placement}
          data-modal-dialog=""
          $side={placement === 'side'}
          $wide={wide}
          aria-describedby={undefined}
          onCloseAutoFocus={restoreFocus}
          onEscapeKeyDown={(event) => {
            if (closeDisabled || !closeOnEscape) {
              event.preventDefault()
            }
          }}
          onInteractOutside={(event) => {
            if (closeDisabled) {
              event.preventDefault()
            }
          }}
        >
          {children}
        </DialogSurface>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

const TABBABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Names a `ModalFrame`; renders the child heading in place with `asChild`. */
export const ModalTitle = RadixDialog.Title

/** Matches an open modal dialog, and not a popover, which also has the dialog role. */
export const OPEN_MODAL_SELECTOR = '[data-modal-dialog]'

const Backdrop = styled(RadixDialog.Overlay)`
  position: fixed;
  inset: 0;
  z-index: ${zIndex.dialog};
  background: ${color.overlay};
`

const DialogSurface = styled(RadixDialog.Content)<{ $wide: boolean; $side: boolean }>`
  position: fixed;
  inset: 0;
  z-index: ${zIndex.dialog};
  width: min(${({ $wide }) => ($wide ? '1400px' : '960px')}, calc(100vw - 2 * ${space[8]}));
  height: fit-content;
  max-height: calc(100dvh - 2 * ${space[8]});
  margin: auto;
  overflow: auto;
  padding: ${space[10]};
  border: 1px solid ${color.line};
  border-radius: ${radius.dialog};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  ${motion.enter}
  a {
    color: ${color.accent};
  }
  ${({ $side }) =>
    $side &&
    css`
      inset: 0 0 0 auto;
      width: min(420px, 100vw);
      height: 100dvh;
      max-height: 100dvh;
      margin: 0;
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

const Title = styled(RadixDialog.Title)`
  margin: 0;
  ${type.h2}
`
