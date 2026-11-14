import styled from 'styled-components'
import { color, font, radius, space } from '#/theme/generated/tokens'

/** Shortcut hints only. */
export const Kbd = styled.kbd`
  padding: 0 ${space[2]};
  border: 1px solid ${color.lineStrong};
  border-bottom-width: 2px;
  border-radius: ${radius.xs};
  background: ${color.surface};
  font-family: ${font.mono};
  /* literal-allowed: the keycap glyph, a step under the label size it sits beside */
  font-size: 11px;
`
