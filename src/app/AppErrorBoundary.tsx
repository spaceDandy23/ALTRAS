import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Unexpected application error', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="not-found" role="alert">
        <h1>Something went wrong</h1>
        <p>ALTRAS could not display this page.</p>
        <Button onClick={() => window.location.reload()}>Reload ALTRAS</Button>
      </main>
    );
  }
}
