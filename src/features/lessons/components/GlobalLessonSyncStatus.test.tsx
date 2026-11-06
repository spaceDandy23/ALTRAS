import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalLessonSyncStatus } from './GlobalLessonSyncStatus';
import { useAuthStore } from '@/stores/auth.store';

const mocks = vi.hoisted(() => ({ lessons: vi.fn(), assessments: vi.fn() }));

vi.mock('../attempts/attempt.service', () => ({ syncPendingLessonDrafts: mocks.lessons }));
vi.mock('@/features/assessments/assessment-sync.service', () => ({
  syncPendingAssessmentDrafts: mocks.assessments,
}));

const empty = { attempts: 0, failed: 0, pending: 0, invalid: 0 };

describe('GlobalLessonSyncStatus', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: '20000000-0000-4000-8000-000000000002',
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    mocks.lessons.mockReset();
    mocks.assessments.mockReset().mockResolvedValue(empty);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('continues slow retries after the fast burst and pauses while hidden', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.lessons.mockResolvedValue({ ...empty, pending: 1 });
    render(<GlobalLessonSyncStatus userId="20000000-0000-4000-8000-000000000002" />);
    await act(async () => vi.advanceTimersByTimeAsync(44_000));
    const afterBurst = mocks.assessments.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.assessments).toHaveBeenCalledTimes(afterBurst + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(mocks.assessments).toHaveBeenCalledTimes(afterBurst + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(mocks.assessments).toHaveBeenCalledTimes(afterBurst + 2);
  });

  it('replays lesson, assessment, then dependent lesson work on reconnect', async () => {
    let finish!: (value: typeof empty) => void;
    mocks.lessons
      .mockImplementationOnce((_userId, _excluded, onWorkFound) => {
        onWorkFound?.(1);
        return new Promise((resolve) => {
          finish = resolve;
        });
      })
      .mockResolvedValue(empty);
    render(
      <GlobalLessonSyncStatus
        userId="20000000-0000-4000-8000-000000000002"
        excludedAttemptId="10000000-0000-4000-8000-000000000001"
      />,
    );
    expect(mocks.lessons).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));

    expect(await screen.findByText('Syncing progress\u2026')).toBeInTheDocument();
    await act(async () => finish(empty));
    await waitFor(() =>
      expect(screen.queryByText('Syncing progress\u2026')).not.toBeInTheDocument(),
    );
    expect(mocks.lessons).toHaveBeenCalledTimes(2);
    expect(mocks.assessments).toHaveBeenCalledOnce();
  });

  it('keeps an attention state and schedules retries while pending work remains', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.lessons.mockResolvedValue({ ...empty, pending: 1 });

    render(<GlobalLessonSyncStatus userId="20000000-0000-4000-8000-000000000002" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText('Progress sync needs attention. Retrying\u2026')).toBeVisible();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('pauses retries offline and resumes them on reconnect', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.lessons.mockResolvedValue({ ...empty, pending: 1 });
    render(<GlobalLessonSyncStatus userId="20000000-0000-4000-8000-000000000002" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const beforeOffline = mocks.lessons.mock.calls.length;

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event('offline')));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.lessons).toHaveBeenCalledTimes(beforeOffline);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(mocks.lessons.mock.calls.length).toBeGreaterThan(beforeOffline);
  });

  it('does not show a sync message when no pending work exists', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.lessons.mockResolvedValue(empty);

    render(<GlobalLessonSyncStatus userId="20000000-0000-4000-8000-000000000002" />);

    await waitFor(() => expect(mocks.lessons).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
