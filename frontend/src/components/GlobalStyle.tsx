import '@fontsource-variable/public-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '../theme/generated/tokens.css'
import { createGlobalStyle } from 'styled-components'
import { color, font, radius } from '../theme/generated/tokens'

/** Application reset and document defaults; component appearance stays locally scoped. */
export const GlobalStyle = createGlobalStyle`
  :root {
    font-family: ${font.sans};
    font-size: 14px;
    line-height: 20px;
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
    outline: 2px solid ${color.accent};
    outline-offset: 2px;
    border-radius: ${radius.sm};
  }
`
