import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Limit render/chunk failures to the right pane; the shell stays navigable.
 * Ordinary stream failures use APR's richer connection/unavailable UI instead. */
export class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <section role='alert'>
      <h1>This section could not load</h1>
      <p>Your saved sample campaigns have not been reset.</p>
      <button type='button' onClick={() => window.location.reload()}>Reload page</button>{' · '}
      <Link to='/'>Return to Home</Link>
    </section> : this.props.children
  }
}
