import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { trackDialogOpeners } from './components/ui'
import { mastheadMotionController } from './theme/masthead-motion'
import { mastheadStyleController } from './theme/masthead-style'
import { themeController } from './theme/theme'

themeController()
mastheadStyleController()
trackDialogOpeners()
mastheadMotionController()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerStateProvider>
      <App />
    </ServerStateProvider>
  </StrictMode>,
)
