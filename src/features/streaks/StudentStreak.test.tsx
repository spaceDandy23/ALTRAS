import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { StudentStreak } from './StudentStreak';
import { getStudentStreak } from './streak.service';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => ({ rpc }) }));
const userId = '20000000-0000-4000-8000-000000000002';
const attemptId = '10000000-0000-4000-8000-000000000001';
const data = {
  user_id: userId,
  current_streak: 3,
  longest_streak: 5,
  last_activity_date: '2026-09-12',
  earned_today: true,
  celebrate: false,
  calendar_timezone: 'Asia/Manila' as const,
  refresh_after_seconds: 1000,
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data, error: null });
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: userId,
      normalizedUsername: 'learner',
      displayName: 'Learner',
      createdAt: 1,
      lastLoginAt: 1,
    },
  });
  useResearcherAccessStore.setState({ userId, status: 'denied' });
});
afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: null, status: 'guest' });
  useResearcherAccessStore.getState().clear();
});

describe('student streak display and server snapshots', () => {
  it('displays the server streak, longest and calendar rule without computing increments', async () => {
    render(<StudentStreak />);
    expect(await screen.findByText('3 day streak')).toBeVisible();
    expect(screen.getByText('Longest: 5 days')).toBeVisible();
    expect(screen.getByText(/Philippine time/)).toBeVisible();
    expect(rpc).toHaveBeenCalledWith('get_student_streak', { p_attempt_id: null });
  });

  it.each(['idle', 'loading', 'authorized', 'error'] as const)(
    'does not fetch/render in %s experience resolution',
    (status) => {
      useResearcherAccessStore.setState({ status });
      const view = render(<StudentStreak />);
      expect(view.container).toBeEmptyDOMElement();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('keeps guest and mismatched-account state empty', () => {
    useAuthStore.setState({ status: 'guest' });
    const view = render(<StudentStreak />);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    useAuthStore.setState({ status: 'authenticated' });
    useResearcherAccessStore.setState({ userId: 'another-account' });
    expect(render(<StudentStreak />).container).toBeEmptyDOMElement();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows a server-awarded celebration only once across Strict Mode and route remount', async () => {
    rpc.mockResolvedValueOnce({ data: { ...data, celebrate: true }, error: null });
    const view = render(
      <StrictMode>
        <StudentStreak attemptId={attemptId} />
      </StrictMode>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('3 day streak!');
    expect(rpc).toHaveBeenCalledTimes(1);
    view.rerender(
      <StrictMode>
        <StudentStreak attemptId={attemptId} />
      </StrictMode>,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    view.unmount();
    const next = render(<StudentStreak attemptId={attemptId} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(next.container).toBeEmptyDOMElement();
  });

  it('shows no celebration during an unresolved/failed result-streak request, then retries on reconnect', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    render(<StudentStreak attemptId={attemptId} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rpc.mockResolvedValueOnce({
      data: { ...data, current_streak: 1, celebrate: true },
      error: null,
    });
    fireEvent.online(window);
    expect(await screen.findByRole('status')).toHaveTextContent('Streak started!');
  });

  it('does not represent a failed load as a zero streak and allows retry', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    render(<StudentStreak />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('3 day streak')).toBeVisible();
  });

  it('refreshes server data after another device completes a lesson and on remount', async () => {
    const view = render(<StudentStreak />);
    await screen.findByText('3 day streak');
    rpc.mockResolvedValue({ data: { ...data, current_streak: 4 }, error: null });
    fireEvent.focus(window);
    expect(await screen.findByText('4 day streak')).toBeVisible();
    view.unmount();
    render(<StudentStreak />);
    expect(await screen.findByText('4 day streak')).toBeVisible();
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('re-fetches at the database-specified midnight boundary without changing counts locally', async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValueOnce({ data: { ...data, refresh_after_seconds: 1 }, error: null });
    render(<StudentStreak />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('3 day streak')).toBeVisible();
    rpc.mockResolvedValue({
      data: { ...data, current_streak: 0, earned_today: false },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('0 day streak')).toBeVisible();
  });

  it('discards a stale response when the user changes', async () => {
    let finish!: (response: unknown) => void;
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<StudentStreak />);
    await act(async () => {
      useAuthStore.setState({ status: 'guest', user: null });
      finish({ data, error: null });
    });
    expect(screen.queryByLabelText('Daily learning streak')).not.toBeInTheDocument();
  });

  it('rejects snapshots for another user and never transmits counters or dates', async () => {
    rpc.mockResolvedValue({ data: { ...data, user_id: attemptId }, error: null });
    await expect(getStudentStreak(userId)).rejects.toThrow('another account');
    expect(rpc).toHaveBeenCalledWith('get_student_streak', { p_attempt_id: null });
  });
});
