import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { getActiveAttempt } from '@/features/lessons/attempts/attempt.service';
import { getLessonHubData, getTotalXp } from '@/features/lessons/progress/progress.service';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { MainMenuPage } from './MainMenuPage';
import { selectHomeLesson } from './home-lesson-selection';
import {
  recordLessonUnlock,
  resetLessonUnlocks,
} from '@/features/lessons/progress/progress-transitions';

vi.mock('@/features/lessons/attempts/attempt.service', () => ({ getActiveAttempt: vi.fn() }));
vi.mock('@/features/lessons/progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
  getTotalXp: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => ({ playSfx: vi.fn() }));

const userId = '20000000-0000-4000-8000-000000000002';

function progress(lessonId: string, status: LessonProgress['status']): LessonProgress {
  return {
    id: `${userId}:${lessonId}`,
    userId,
    lessonId,
    status,
    bestScore: status === 'cleared' ? 100 : 0,
    bestStarCount: status === 'cleared' ? 3 : 0,
    attemptCount: status === 'cleared' ? 1 : 0,
    xpAwarded: status === 'cleared' ? 130 : 0,
    firstStartedAt: null,
    lastAttemptedAt: null,
    clearedAt: status === 'cleared' ? 2 : null,
  };
}

describe('main menu loading failures', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
    resetLessonUnlocks();
  });

  it('selects an active attempt before any otherwise available lesson', () => {
    const [first, second] = packagedContent.lessons;
    const active: LessonAttempt = {
      id: '10000000-0000-4000-8000-000000000011',
      userId,
      lessonId: first.id,
      contentVersion: first.contentVersion,
      status: 'active',
      startedAt: 1,
      lastUpdatedAt: 1,
      completedAt: null,
      abandonedAt: null,
      answers: [],
      finalScore: null,
      starCount: null,
      cleared: null,
      xpImprovement: 0,
    };
    const entries = [
      { lesson: first, progress: progress(first.id, 'in-progress') },
      { lesson: second, progress: progress(second.id, 'available') },
    ];

    expect(selectHomeLesson(entries, active)?.lesson.id).toBe(first.id);
  });

  it('selects the first unlocked incomplete lesson instead of a cleared lesson', () => {
    const [first, second] = packagedContent.lessons;
    const entries = [
      { lesson: first, progress: progress(first.id, 'cleared') },
      { lesson: second, progress: progress(second.id, 'available') },
    ];

    expect(selectHomeLesson(entries, null)?.lesson.id).toBe(second.id);
  });

  it('selects the first available lesson for a new student', () => {
    const [first, second] = packagedContent.lessons;
    const entries = [
      { lesson: first, progress: progress(first.id, 'available') },
      { lesson: second, progress: progress(second.id, 'locked') },
    ];

    expect(selectHomeLesson(entries, null)?.lesson.id).toBe(first.id);
  });

  it('uses needs-retry copy with the matching retry action for an uncleared attempt', async () => {
    const [first, second] = packagedContent.lessons;
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        {
          lesson: first,
          progress: { ...progress(first.id, 'available'), attemptCount: 1, bestScore: 40 },
        },
        { lesson: second, progress: progress(second.id, 'locked') },
      ],
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(40);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'retry',
        displayName: 'Retry',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(`Needs retry · ${first.activities.length} activities`),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /Try lesson again/ })).toBeVisible();
    expect(
      screen.queryByText(`Not started · ${first.activities.length} activities`),
    ).not.toBeInTheDocument();
  });

  it('uses the latest cleared lesson as the all-complete fallback', () => {
    const [first, second] = packagedContent.lessons;
    const entries = [
      { lesson: first, progress: progress(first.id, 'cleared') },
      { lesson: second, progress: progress(second.id, 'cleared') },
    ];

    expect(selectHomeLesson(entries, null)?.lesson.id).toBe(second.id);
  });

  it('shows the unlock transition immediately with the newly selected lesson', async () => {
    const [first, second] = packagedContent.lessons;
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        { lesson: first, progress: progress(first.id, 'cleared') },
        { lesson: second, progress: progress(second.id, 'available') },
      ],
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(130);
    recordLessonUnlock(userId, first.id);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible();
    expect(screen.getByText('Lesson 1 complete. Lesson 2 is unlocked.')).toBeVisible();
  });

  it('does not resurrect a consumed unlock announcement on remount', async () => {
    const [first, second] = packagedContent.lessons;
    const hub = {
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        { lesson: first, progress: progress(first.id, 'cleared') },
        { lesson: second, progress: progress(second.id, 'available') },
      ],
    };
    vi.mocked(getLessonHubData).mockResolvedValue(hub);
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(130);
    recordLessonUnlock(userId, first.id);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    const firstView = render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Lesson 1 complete. Lesson 2 is unlocked.')).toBeVisible();
    firstView.unmount();
    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible();
    expect(screen.queryByText('Lesson 1 complete. Lesson 2 is unlocked.')).not.toBeInTheDocument();
  });

  it('uses the existing all-complete copy instead of pick-up guidance', async () => {
    const [first, second] = packagedContent.lessons;
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        { lesson: first, progress: progress(first.id, 'cleared') },
        { lesson: second, progress: progress(second.id, 'cleared') },
      ],
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(260);
    recordLessonUnlock(userId, first.id);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );

    expect(await screen.findAllByText('All available lessons complete.')).toHaveLength(2);
    expect(screen.queryByText(/Pick up where you left off/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review lesson/ })).toBeVisible();
  });

  it('renders a recoverable error and retries the rejected load', async () => {
    const lesson = packagedContent.lessons[0];
    const hub = {
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        {
          lesson,
          progress: {
            id: `${userId}:${lesson.id}`,
            userId,
            lessonId: lesson.id,
            status: 'available' as const,
            bestScore: 0,
            bestStarCount: 0,
            attemptCount: 0,
            xpAwarded: 0,
            firstStartedAt: null,
            lastAttemptedAt: null,
            clearedAt: null,
          },
        },
      ],
    };
    vi.mocked(getLessonHubData).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(hub);
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Home is unavailable' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: lesson.title })).toBeInTheDocument();
    expect(getLessonHubData).toHaveBeenCalledTimes(2);
  });
});
