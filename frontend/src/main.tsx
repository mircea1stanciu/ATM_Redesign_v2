import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import App from './App'
import { queryClient } from './app/queryClient'
import { initTheme } from './app/theme'
import { ToastProvider, TooltipProvider } from './ui'
import './index.css'

// Apply the saved theme before the first paint, to avoid a flash.
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
