import { Component, type ErrorInfo, type ReactNode } from 'react';

// ============================================================================
// ErrorBoundary — the app's last line of defense.
//
// Without one of these, a single unexpected error anywhere in the React
// tree unmounts EVERYTHING and leaves a blank white page with no way back
// except a manual reload. A boundary must be a class component: React has
// no hook equivalent of componentDidCatch.
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown on the recovery screen, e.g. "the practice session". */
  area?: string;
  /** Optional escape hatch back to a known-good screen. When absent, the
   * only option offered is a reload. */
  onRecover?: () => void;
  recoverLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Mindful Metronome hit an unexpected error:', error, info.componentStack);
  }

  private handleRecover = () => {
    this.setState({ error: null });
    this.props.onRecover?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { area, onRecover, recoverLabel } = this.props;

    return (
      <div className="crash-screen">
        <div className="crash-card">
          <span className="crash-emoji">◐</span>
          <h1>Something went wrong{area ? ` in ${area}` : ''}</h1>
          <p className="crash-reassurance">
            Nothing is lost — the practice section saves locally on your device. Only what was on screen was
            interrupted.
          </p>

          <div className="crash-actions">
            {onRecover && (
              <button className="btn btn-primary btn-large" onClick={this.handleRecover}>
                {recoverLabel ?? '← Back to safety'}
              </button>
            )}
            <button className="btn btn-secondary btn-large" onClick={() => window.location.reload()}>
              ↻ Reload
            </button>
          </div>

          <details className="crash-details">
            <summary>Technical details</summary>
            <pre>{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
