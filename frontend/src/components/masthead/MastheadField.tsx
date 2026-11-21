import styled from 'styled-components'
import { dottedGround, media } from '#/components/ui'
import { pageWidth } from '#/theme/generated/tokens'
import { barGapMask, compactBarGapMask } from './current-masks'
import { ElectronicsCurrent } from './ElectronicsCurrent'

export type FieldStyle = 'window' | 'fade'

type MastheadFieldProps = {
  style: FieldStyle
  /** The page's content width, which Fading down keeps clear of parts below the bar. */
  width: keyof typeof pageWidth
}

/**
 * The electronics current behind the page: fixed behind the whole window, or in a band at the
 * top of the page that fades down. Decorative and never interactive.
 */
export function MastheadField({ style, width }: MastheadFieldProps) {
  if (style === 'window') {
    return (
      <WholeWindow aria-hidden="true" data-testid="masthead-field" data-style={style}>
        <ElectronicsCurrent layout="field" />
      </WholeWindow>
    )
  }

  return (
    <FadingBand aria-hidden="true" data-testid="masthead-field" data-style={style}>
      <ClearOfText $contentWidth={pageWidth[width]}>
        <ElectronicsCurrent layout="field" />
      </ClearOfText>
    </FadingBand>
  )
}

// Below every in-flow and positioned element, above the root's ground. A layer token would
// need a stacking context around the app, which would trap toasts below portalled menus.
const BEHIND_CONTENT = -1

const FADE_SOLID_PX = 140
const FADE_CLEAR_PX = 420

const WholeWindow = styled.div`
  position: fixed;
  inset: 0;
  /* literal-allowed: the layer below content; no token is below the base layer */
  z-index: ${BEHIND_CONTENT};
  pointer-events: none;
`

const FadingBand = styled.div`
  position: absolute;
  inset: 0 0 auto;
  height: ${FADE_CLEAR_PX}px;
  /* literal-allowed: the layer below content; no token is below the base layer */
  z-index: ${BEHIND_CONTENT};
  pointer-events: none;
  ${dottedGround}
  mask-image: linear-gradient(
    to bottom,
    black 0,
    black ${FADE_SOLID_PX}px,
    transparent ${FADE_CLEAR_PX}px
  );
`

/**
 * Parts show in the bar's text gap within the bar's height and, below the bar, only outside the
 * page's content column. The two layers add up; the band's own mask then fades them down.
 */
const ClearOfText = styled.div<{ $contentWidth: string }>`
  position: absolute;
  inset: 0;
  --content-edge: max(0px, calc((100% - ${({ $contentWidth }) => $contentWidth}) / 2));
  mask-image:
    ${barGapMask},
    linear-gradient(
      to right,
      black 0,
      black var(--content-edge),
      transparent var(--content-edge),
      transparent calc(100% - var(--content-edge)),
      black calc(100% - var(--content-edge))
    );
  mask-repeat: no-repeat;
  mask-position:
    0 0,
    0 var(--masthead-height, 64px);
  mask-size:
    100% var(--masthead-height, 64px),
    100% 100%;

  ${media.compact} {
    mask-image: ${compactBarGapMask}, linear-gradient(transparent, transparent);
  }
`
