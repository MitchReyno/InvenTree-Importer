import styled from 'styled-components'
import { pageWidth, space } from '../theme/generated/tokens'
import { media } from './ui/media'

/** The page's side padding around the full-width masthead and the content. */
export const AppShell = styled.div`
  padding: 0 ${space[12]};
  ${media.compact} {
    padding: 0 ${space[8]};
  }
`

/** Main content at the design's width for the page, centred under the masthead. */
export const PageContent = styled.div<{ $width: 'content' | 'review' }>`
  max-width: ${({ $width }) => pageWidth[$width]};
  margin: 0 auto;
`

export const Main = styled.main`
  margin: 0 0 ${space[8]};
`
