import { css } from 'styled-components'
import { color, radius, shadow, space } from '#/theme/generated/tokens'

/** The masthead's dotted ground, as on the canvas. */
export const dottedGround = css`
  background-color: ${color.mastheadGround};
  background-image: radial-gradient(circle, ${color.mastheadDot} 1px, transparent 1.4px);
  background-size: 16px 16px;
`

/** Root selector for the style whose current covers the whole window. */
export const onWholeWindow = ":root[data-masthead='window']"

/** Root selector for the style whose current fades down from the top of the page. */
export const onFadingDown = ":root[data-masthead='fade']"

/**
 * Behind the whole window, text placed directly on the field gets a patch of ground so parts
 * pass behind the patch, not the text. The negative margin keeps the text where it was.
 */
export const onField = css`
  ${onWholeWindow} & {
    width: fit-content;
    max-width: 100%;
    background-color: ${color.mastheadGround};
    padding-inline: ${space[3]};
    margin-inline-start: calc(-1 * ${space[3]});
    border-radius: ${radius.sm};
    box-decoration-break: clone;
  }
`

/** Behind the whole window, a block of loose text (such as a nav) sits on one patch of ground. */
export const groundBehindOnField = css`
  ${onWholeWindow} & {
    background-color: ${color.mastheadGround};
    border-radius: ${radius.sm};
  }
`

/** Behind the whole window, cards that sit on the field are raised off it. */
export const raisedOnField = css`
  ${onWholeWindow} & {
    box-shadow: ${shadow};
  }
`
