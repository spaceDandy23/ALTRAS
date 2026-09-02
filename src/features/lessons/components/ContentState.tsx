import type { ReactNode } from 'react';
import { Panel } from '@/components/ui/Panel';
import { LoadingState } from '@/components/ui/LoadingState';
import { useContentStore } from '@/stores/content.store';

export function ContentState({ children }: { children: ReactNode }) {
  const status = useContentStore((state) => state.status);
  const error = useContentStore((state) => state.error);
  const initialize = useContentStore((state) => state.initialize);

  if (status === 'idle' || status === 'loading') {
    return <LoadingState variant="page" message="Preparing local lessons…" />;
  }
  if (status === 'error') {
    return (
      <Panel className="lesson-error" accent="red">
        <h1>Lessons could not be prepared</h1>
        <p>{error}</p>
        <button className="button button--danger" onClick={() => void initialize()}>
          Try again
        </button>
      </Panel>
    );
  }
  return children;
}
