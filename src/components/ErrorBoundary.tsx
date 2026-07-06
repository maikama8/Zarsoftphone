import React from 'react'

interface Props { children: React.ReactNode }
interface State { hasError: boolean }

// Catches React render-phase errors (which don't fire window.error) and
// forwards them to the main process so we can diagnose blank-screen crashes.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const msg = `[Renderer/ReactError] ${error.name}: ${error.message}\n${error.stack || ''}\n--- Component stack ---\n${info.componentStack || ''}`
    try { console.error(msg) } catch { /* ignore */ }
    try { (window as any).electronAPI?.log?.(msg) } catch { /* main gone */ }
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 20, color: '#ff6b6b', fontFamily: 'monospace', fontSize: 11 }}>React error — see terminal log</div>
    }
    return this.props.children
  }
}