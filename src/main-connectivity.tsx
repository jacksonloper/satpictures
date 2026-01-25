import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ConnectivityApp from './ConnectivityApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectivityApp />
  </StrictMode>,
)
