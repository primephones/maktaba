import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';

interface Props {
  /** What failed, in the user's words: "the library", "this book". */
  what: string;
  children: ReactNode;
  /** Changing this clears the error (e.g. the route). */
  resetKey?: string;
  compact?: boolean;
}

/**
 * A fault in one part of the app shows a plain message there, and the rest keeps
 * working. Nothing ever falls through to a blank screen.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Maktaba: ${this.props.what} failed`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.compact) {
      return (
        <div className="banner banner--error" role="alert">
          <Icon name="warn" />
          <span className="grow">Something went wrong showing {this.props.what}.</span>
          <button className="btn btn--quiet" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return (
      <div className="screen screen--plain" role="alert">
        <div className="empty">
          <h2>Something went wrong</h2>
          <p>Maktaba couldn’t show {this.props.what}. Your books and notes are safe.</p>
          <button className="btn btn--primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn btn--quiet" onClick={() => { location.hash = '#/'; this.setState({ error: null }); }}>Go to Home</button>
        </div>
      </div>
    );
  }
}
