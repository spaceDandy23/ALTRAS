import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useLessonTransition } from './useLessonTransition';

function Router({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useLessonTransition', () => {
  it('shows loading immediately and ignores repeated launches while work is pending', () => {
    const run = vi.fn(() => new Promise<string>(() => undefined));
    const { result } = renderHook(() => useLessonTransition(), { wrapper: Router });

    act(() => {
      void result.current.startTransition({
        loadingMessage: 'Restoring your attempt…',
        run,
        fallbackError: 'Unable to restore the attempt.',
      });
      void result.current.startTransition({
        loadingMessage: 'Restoring your attempt…',
        run,
        fallbackError: 'Unable to restore the attempt.',
      });
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.transitionBusy).toBe(true);
    expect(result.current.loadingMessage).toBe('Restoring your attempt…');
  });

  it('restores the originating screen with an error when the transition fails', async () => {
    const { result } = renderHook(() => useLessonTransition(), { wrapper: Router });

    await act(async () => {
      await result.current.startTransition({
        loadingMessage: 'Preparing your lesson…',
        run: () => Promise.reject(new Error('The lesson could not be reached.')),
        fallbackError: 'Unable to open this lesson.',
      });
    });

    expect(result.current.transitionBusy).toBe(false);
    expect(result.current.loadingMessage).toBeNull();
    expect(result.current.transitionError).toBe('The lesson could not be reached.');
  });
});
