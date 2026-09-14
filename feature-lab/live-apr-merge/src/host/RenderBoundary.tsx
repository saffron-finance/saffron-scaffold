import { Component, type ReactNode } from 'react'

/** Catch render/lazy-import failures at an explicit containment point. Async
 * event handlers still own their rejections; this boundary never retries writes. */
export class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Last resort outside the router, theme and wallet shell. Plain HTML and inline
 * styles keep recovery independent of the components/assets that just failed.
 * Preserve storage; only an explicit user action reloads the document. */
export function RootBoundary({ children }: { children: ReactNode }) {
  return <RenderBoundary fallback={<main role='alert' data-root-recovery style={{
    minHeight: '100vh', boxSizing: 'border-box', padding: '48px 24px', background: '#09070b',
    color: '#eee7f2', font: '16px/1.6 system-ui, sans-serif',
  }}>
    <h1>Saffron could not load</h1>
    <p>Reload to recover the interface. Your saved requests have not been cleared.</p>
    <p>If you submitted a transaction, check its status before trying again.</p>
    <button type='button' onClick={() => window.location.reload()} style={{
      padding: '10px 18px', border: '1px solid #b58aca', borderRadius: 6,
      background: '#35203e', color: '#fff', font: 'inherit', cursor: 'pointer',
    }}>Reload page</button>{' · '}
    <a href={import.meta.env.BASE_URL} style={{ color: '#dab5f1' }}>Return to Home</a>
  </main>}>{children}</RenderBoundary>
}
