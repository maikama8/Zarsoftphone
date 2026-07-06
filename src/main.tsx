import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Forward unhandled renderer errors to the main process so they show up in
// the terminal. We do NOT override console.error — doing so breaks Vite's
// HMR client (it watches console.error for warnings and triggers a full
// page reload, which tears down the AudioContext mid-call → blank screen).
const forwardError = (label: string, ...args: unknown[]) => {
  const msg = `[Renderer/${label}] ${args.map(a => {
    try { return a instanceof Error ? `${a.name}: ${a.message}\n${a.stack || ''}` : String(a) }
    catch { return String(a) }
  }).join(' | ')}`
  // Use the original console.error to avoid recursion / breaking Vite HMR.
  try { console.warn(msg) } catch { /* ignore */ }
  try { (window as any).electronAPI?.log?.(msg) } catch { /* main gone */ }
}

window.addEventListener('error', (e) => forwardError('window.error', e.message, e.error, e.filename, e.lineno))
window.addEventListener('unhandledrejection', (e) => forwardError('unhandledrejection', e.reason))
window.addEventListener('beforeunload', () => {
  try { (window as any).electronAPI?.log?.('[Renderer] beforeunload fired — page is being unloaded') } catch { /* ignore */ }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)