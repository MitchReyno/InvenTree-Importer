import { createGlobalStyle } from 'styled-components'

/** Application reset and document defaults; component appearance stays locally scoped. */
export const GlobalStyle = createGlobalStyle`
  :root {
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    color: #233349;
    background: #f3f5f8;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input, textarea, select { font: inherit; }
  button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
    outline: 3px solid #266ac5;
    outline-offset: 3px;
  }
`
