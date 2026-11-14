import styled, { css } from 'styled-components'
import { color, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import { media } from './media'

/** Under compact, an inline link keeps its line height and gains an invisible 44px hit area. */
export const linkTouchArea = css`
  ${media.compact} {
    position: relative;
    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: max(100%, ${size.touch});
      height: ${size.touch};
      transform: translate(-50%, -50%);
    }
  }
`

export const Link = styled.a`
  color: ${color.accent};
  touch-action: manipulation;
  ${linkTouchArea}
`
export const Panel = styled.section`
  padding: ${space[7]} ${space[8]};
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  margin-bottom: ${space[6]};
  min-width: 0;
`
export const PageTitle = styled.h1`
  ${type.h1}
  margin: ${space[6]} 0;
  overflow-wrap: anywhere;
`
export const Heading = styled.h2`
  ${type.h2}
  margin: 0 0 ${space[6]};
`
export const Subheading = styled.h3`
  ${type.h3}
  margin: 0 0 ${space[5]};
`
export const Paragraph = styled.p`
  line-height: 1.45;
`
export const Small = styled.small`
  display: block;
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.small.weight};
  color: ${color.muted};
  line-height: ${typeVar.small.lineHeight};
  overflow-wrap: anywhere;
`
export const Summary = styled.summary`
  cursor: pointer;
  min-height: ${size.control};
  padding: ${space[4]} 0;
  ${media.compact} {
    min-height: ${size.touch};
  }
`
export const HeadingRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${space[6]};
  flex-wrap: wrap;
  ${Heading} {
    margin-bottom: ${space[4]};
  }
`
