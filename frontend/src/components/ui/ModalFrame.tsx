import * as RadixDialog from '@radix-ui/react-dialog'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, shadow, space, zIndex } from '#/theme/generated/tokens'
import { ModalContainerContext } from '#/context/ModalContainerContext'
import { dialogOpener } from './dialog-opener'
import { motion } from './motion'

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
  // Popovers opened inside portal here, once the surface has mounted.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const mounted = useRef(false)
  const fallback = useRef(returnFocus)
  useLayoutEffect(() => {
    fallback.current = returnFocus
  })

  // Runs before Radix moves focus into the dialog, so the opener is still focused or just clicked.
  useLayoutEffect(() => {
    mounted.current = true
    const candidate = dialogOpener()
    // Keeps the recorded opener when a StrictMode replay finds focus already inside.
    if (candidate && !surface.current?.contains(candidate)) {
      opener.current = candidate
    }
    return () => {
      mounted.current = false
    }
  }, [])

  // Focus settles as the surface mounts, before its content's Effects run, as `showModal` did;
  // Radix then finds focus inside and leaves it.
  const attachSurface = useCallback((element: HTMLDivElement | null) => {
    surface.current = element
    setContainer(element)
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
    // The opener, then `returnFocus`, then the title of a modal still open beneath; each may be
    // gone or disabled by now, so the next is tried until one takes focus.
    const candidates = [
      () => (opener.current === document.body ? null : opener.current),
      () => fallback.current?.() ?? null,
      () => openModalTitle(),
    ]
    for (const candidate of candidates) {
      const target = candidate()
      if (target?.isConnected) {
        target.focus()
      }
      if (target && document.activeElement === target) {
        return
      }
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
          <ModalContainerContext.Provider value={container}>
            {children}
          </ModalContainerContext.Provider>
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

// The topmost open modal's title, which is focusable by script.
function openModalTitle(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>(OPEN_MODAL_SELECTOR)
  const top = modals[modals.length - 1]
  const titleId = top?.getAttribute('aria-labelledby')
  const title = titleId ? document.getElementById(titleId) : null
  return title ?? top ?? null
}

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
      /* Leaves a strip of dimmed page beside the drawer on phones, to click to close it. */
      width: min(420px, calc(100vw - 2 * ${space[8]}));
      height: 100dvh;
      max-height: 100dvh;
      margin: 0;
      border-width: 0 0 0 1px;
      border-radius: 0;
    `}
`
