import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, shadow, space } from '../../theme/generated/tokens'

type StickyFooterProps = {
  label: string
  summary: ReactNode
  primary: ReactNode
  leading?: ReactNode
}

/** The only non-floating element with a shadow; holds one primary action. */
export function StickyFooter({ label, summary, primary, leading }: StickyFooterProps) {
  const footer = useRef<HTMLDivElement>(null)

  // Toasts read this clearance so they never cover the footer's primary action.
  useLayoutEffect(() => {
    const element = footer.current
    if (!element) {
      return
    }
    const root = document.documentElement

    function publishHeight() {
      root.style.setProperty(
        FOOTER_CLEARANCE,
        `${Math.ceil(element!.getBoundingClientRect().height)}px`,
      )
    }

    publishHeight()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publishHeight) : null
    observer?.observe(element)

    return () => {
      observer?.disconnect()
      root.style.removeProperty(FOOTER_CLEARANCE)
    }
  }, [])

  return (
    <Footer ref={footer} role="region" aria-label={label}>
      {leading}
      <Summary>{summary}</Summary>
      {primary}
    </Footer>
  )
}

/** Height of the mounted sticky footer, read by Toast. */
export const FOOTER_CLEARANCE = '--sticky-footer-height'

const Footer = styled.div`
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space['2-5']};
  padding: ${space[3]} ${space['3-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  box-shadow: ${shadow};
`

const Summary = styled.div`
  flex: 1;
  min-width: 0;
`
