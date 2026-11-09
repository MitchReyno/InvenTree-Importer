import styled from 'styled-components'
import { pageWidth, space } from '#/theme/generated/tokens'
import { media } from './ui/media'

/** A page's content at the design's width, centred, with the page padding inside it. */
export const PageContent = styled.div<{ $width: 'content' | 'review' }>`
  max-width: ${({ $width }) => pageWidth[$width]};
  margin: 0 auto;
  padding: ${space[12]} ${space[12]} 0;
  ${media.compact} {
    padding: ${space[8]} ${space[8]} 0;
  }
`

export const Main = styled.main`
  padding-bottom: ${space[12]};
`
