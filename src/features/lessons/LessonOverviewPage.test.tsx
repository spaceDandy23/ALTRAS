import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { LessonOverviewPage } from './LessonOverviewPage';
import { getActiveAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import { getLesson } from './content/content.service';
import { packagedContent } from './content/packaged-content';
import { getLessonProgress } from './progress/progress.service';
import { db } from '@/db/database';
import { createLessonDraft, saveLessonDraft } from './attempts/lesson-draft.service';

vi.mock('./attempts/attempt.service', () => ({
  getActiveAttempt: vi.fn(),
  restartAttempt: vi.fn(),
  startOrResumeAttempt: vi.fn(),
}));
vi.mock('./content/content.service', () => ({ getLesson: vi.fn() }));
vi.mock('./progress/progress.service', () => ({ getLessonProgress: vi.fn() }));
vi.mock('@/services/audio/audio.manager', () => ({ playSfx: vi.fn() }));

function RouteDriver({ destination }: { destination: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate(destination);
  }, [destination, navigate]);
  return null;
}

describe('lesson overview transitions', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await db.lessonDrafts.clear();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('shows View Results and Restart Lesson without Resume for a completed attempt', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000008';
    const completedAttempt: LessonAttempt = {
      id: '10000000-0000-4000-8000-000000000008',
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed',
      startedAt: 1,
      lastUpdatedAt: 2,
      completedAt: 2,
      abandonedAt: null,
      answers: [],
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 100,
    };
    await saveLessonDraft(createLessonDraft(completedAttempt, lesson));
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getLessonProgress).mockResolvedValue({
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'cleared',
      bestScore: 100,
      bestStarCount: 3,
      attemptCount: 1,
      xpAwarded: 100,
      firstStartedAt: 1,
      lastAttemptedAt: 2,
      clearedAt: 2,
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'completed_test',
        displayName: 'Completed Test',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
          <Route path="/lessons/:lessonId/result/:attemptId" element={<p>Results page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'View Results' })).toHaveAttribute(
      'href',
      `/lessons/${lesson.id}/result/${completedAttempt.id}`,
    );
    expect(screen.getByRole('button', { name: 'Restart Lesson' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resume lesson' })).not.toBeInTheDocument();
  });

  it('resumes an already loaded attempt immediately without repeating the remote lookup', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attempt: LessonAttempt = {
      id: '10000000-0000-4000-8000-000000000001',
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
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
    const progress: LessonProgress = {
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'in-progress',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: 1,
      lastAttemptedAt: null,
      clearedAt: null,
    };

    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getLessonProgress).mockResolvedValue(progress);
    vi.mocked(getActiveAttempt).mockResolvedValue(attempt);
    vi.mocked(startOrResumeAttempt).mockResolvedValue(attempt);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'resume_test',
        displayName: 'Resume Test',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
          <Route
            path="/lessons/:lessonId/play/:attemptId"
            element={<p>Lesson player destination</p>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Resume lesson' }));

    expect(await screen.findByText('Lesson player destination')).toBeVisible();
    expect(startOrResumeAttempt).toHaveBeenCalledWith(expect.anything(), userId, lesson.id);
    expect(getLesson).toHaveBeenCalledWith(expect.anything(), lesson.id, attempt.id);
  });

  it('names the configured prerequisite instead of hardcoding Lesson 1', async () => {
    const lesson = {
      ...packagedContent.lessons[1],
      id: 'lesson-future',
      prerequisiteLessonId: packagedContent.lessons[1].id,
    };
    const userId = '20000000-0000-4000-8000-000000000007';
    vi.mocked(getLesson).mockImplementation(async (_db, id) =>
      id === lesson.id ? lesson : packagedContent.lessons[1],
    );
    vi.mocked(getLessonProgress).mockResolvedValue({
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'locked',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'prerequisite',
        displayName: 'Learner',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('Clear Order Matters to unlock this lesson.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start lesson' })).not.toBeInTheDocument();
  });

  it('shows reusable lesson-introduction guidance without page-owned asset paths', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000003';
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getLessonProgress).mockResolvedValue({
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'guidance_test',
        displayName: 'Guidance Test',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    const { container } = render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'explaining',
    );
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^\/assets\/characters\//);
  });

  it('renders CMS vocabulary in the overview reference style instead of Operation words', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000009';
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getLessonProgress).mockResolvedValue({
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'teaching_content',
        displayName: 'Teaching Content',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('table', { name: 'Vocabulary' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'Constant' })).toBeVisible();
    expect(screen.getByText('A single fixed number')).toBeVisible();
    expect(screen.getByText('(-38, -20, -7, 0, 7, 20, 38)')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Operation words' })).not.toBeInTheDocument();
  });

  it('renders an error after rejection and retries without remaining on the loader', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000004';
    vi.mocked(getLesson).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(lesson);
    vi.mocked(getLessonProgress).mockResolvedValue({
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    });
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
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
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Lesson unavailable' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: lesson.title })).toBeInTheDocument();
  });

  it('discards a late response after the route changes', async () => {
    const [firstLesson, secondLesson] = packagedContent.lessons;
    const userId = '20000000-0000-4000-8000-000000000006';
    let resolveFirst!: (lesson: typeof firstLesson) => void;
    vi.mocked(getLesson).mockImplementation((_database, lessonId) =>
      lessonId === firstLesson.id
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(secondLesson),
    );
    vi.mocked(getLessonProgress).mockImplementation(async (_database, _userId, lessonId) => ({
      id: `${userId}:${lessonId}`,
      userId,
      lessonId,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    }));
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'route_change',
        displayName: 'Route Change',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    const renderTree = (destination: string) => (
      <MemoryRouter initialEntries={[`/lessons/${firstLesson.id}`]}>
        <RouteDriver destination={destination} />
        <Routes>
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(renderTree(`/lessons/${firstLesson.id}`));
    await waitFor(() => expect(getLesson).toHaveBeenCalledWith(expect.anything(), firstLesson.id));
    view.rerender(renderTree(`/lessons/${secondLesson.id}`));
    expect(await screen.findByRole('heading', { name: secondLesson.title })).toBeInTheDocument();

    await act(async () => resolveFirst(firstLesson));
    expect(screen.getByRole('heading', { name: secondLesson.title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: firstLesson.title })).not.toBeInTheDocument();
  });
});
