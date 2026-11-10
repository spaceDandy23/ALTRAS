import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonElapsedTimer, lessonTimerStorageKey } from './LessonElapsedTimer';

describe('lesson elapsed timer', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('pauses while unmounted and resumes the saved active time for the same attempt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const storageKey = lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-1');
    const first = render(<LessonElapsedTimer startedAt={1} storageKey={storageKey} />);

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:05');
    first.unmount();

    act(() => vi.advanceTimersByTime(60 * 60 * 1_000));
    render(<LessonElapsedTimer startedAt={1} storageKey={storageKey} />);
    expect(screen.getByRole('timer')).toHaveTextContent('0:05');
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:07');
  });

  it('pauses when the document is hidden and resumes when visible', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const storageKey = lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-2');
    const { unmount } = render(<LessonElapsedTimer startedAt={1} storageKey={storageKey} />);

    act(() => vi.advanceTimersByTime(5_000));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:05');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:07');
    unmount();

    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  });

  it('keeps timer storage isolated by user, lesson and attempt', () => {
    expect(lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-1')).not.toBe(
      lessonTimerStorageKey('user-2', 'lesson-1', 'attempt-1'),
    );
    expect(lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-1')).not.toBe(
      lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-2'),
    );
  });

  it('does not use wall-clock time for a completed attempt with no saved active-time record', () => {
    const storageKey = lessonTimerStorageKey('user-1', 'lesson-1', 'attempt-3');

    render(<LessonElapsedTimer startedAt={1_000} stoppedAt={10_000_000} storageKey={storageKey} />);

    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
  });
});
