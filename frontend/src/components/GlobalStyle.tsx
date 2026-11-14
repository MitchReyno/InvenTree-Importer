import '@fontsource-variable/public-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '#/theme/generated/tokens.css'
import { createGlobalStyle } from 'styled-components'
import { color, font, radius, ring, typeVar } from '#/theme/generated/tokens'

/** Application reset and document defaults; component appearance stays locally scoped. */
export const GlobalStyle = createGlobalStyle`
  :root {
    font-family: ${font.sans};
    font-size: ${typeVar.body.size};
    line-height: ${typeVar.body.lineHeight};
    color: ${color.fg};
    background: ${color.bg};
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input, textarea, select { font: inherit; color: inherit; }
  code, kbd, samp, pre { font-family: ${font.mono}; }
  :focus-visible {
    outline: ${ring.width} solid ${color.accent};
    outline-offset: ${ring.offset};
    border-radius: ${radius.sm};
  }
`
