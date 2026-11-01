import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ServerStateProvider } from './components/query/ServerStateProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerStateProvider>
      <App />
    </ServerStateProvider>
  </StrictMode>,
)
