import type { ReactNode } from 'react'
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
  return (
    <Footer role="region" aria-label={label}>
      {leading}
      <Summary>{summary}</Summary>
      {primary}
    </Footer>
  )
}

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
