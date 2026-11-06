import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { db } from '@/db/database';
import { packagedContent } from './content/packaged-content';
import { getLessonHubData, getTotalXp } from './progress/progress.service';
import { LessonsPage } from './LessonsPage';
import type { LessonHubData } from './progress/progress.service';
import { createLessonDraft, saveLessonDraft } from './attempts/lesson-draft.service';

vi.mock('./progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
  getTotalXp: vi.fn(),
}));

const userId = '20000000-0000-4000-8000-000000000002';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function authenticate(id = userId) {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id,
      normalizedUsername: 'student',
      displayName: 'Student',
      createdAt: 1,
      lastLoginAt: 1,
    },
  });
  useContentStore.setState({ status: 'ready', error: null });
}

describe('lesson hub authoritative progress', () => {
  afterEach(async () => {
    cleanup();
    vi.resetAllMocks();
    await db.lessonDrafts.clear();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('waits for the authoritative online catalog instead of flashing a partial local draft list', async () => {
    const remote = deferred<LessonHubData>();
    const lesson = packagedContent.lessons[0];
    await saveLessonDraft(
      createLessonDraft({
        id: '40000000-0000-4000-8000-000000000004',
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
      }, lesson),
    );
    vi.mocked(getLessonHubData).mockReturnValue(remote.promise);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    authenticate();

    render(<MemoryRouter><LessonsPage /></MemoryRouter>);

    expect(await screen.findByText(/Loading your lesson path/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: lesson.title })).toBeNull();
    expect(screen.queryByText('In progress')).toBeNull();

    await act(async () => {
      remote.resolve({
        section: packagedContent.sections[0],
        unit: packagedContent.units[0],
        entries: packagedContent.lessons.map((item) => ({
          lesson: item,
          progress: {
            id: `${userId}:${item.id}`,
            userId,
            lessonId: item.id,
            status: item === lesson ? 'in-progress' : 'locked',
            bestScore: 0,
            bestStarCount: 0,
            attemptCount: 0,
            xpAwarded: 0,
            firstStartedAt: null,
            lastAttemptedAt: null,
            clearedAt: null,
          },
        })),
      });
      await remote.promise;
    });

    expect(await screen.findAllByRole('heading', { level: 2 })).toHaveLength(
      packagedContent.lessons.length,
    );
  });

  it('keeps Lesson 2 cleared after navigating away and loading the hub again', async () => {
    const entries = packagedContent.lessons.map((lesson) => ({
      lesson,
      progress: {
        id: `${userId}:${lesson.id}`,
        userId,
        lessonId: lesson.id,
        status: 'cleared' as const,
        bestScore: 100,
        bestStarCount: 3,
        attemptCount: 1,
        xpAwarded: 130,
        firstStartedAt: 1,
        lastAttemptedAt: 2,
        clearedAt: 2,
      },
    }));
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries,
    });
    vi.mocked(getTotalXp).mockResolvedValue(260);
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

    const firstVisit = render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByText('Cleared')).toHaveLength(entries.length);
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    firstVisit.unmount();

    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByText('Cleared')).toHaveLength(entries.length);
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    expect(getLessonHubData).toHaveBeenCalledTimes(2);
  });

  it('labels an uncleared completed attempt as needing retry with a matching action', async () => {
    const [first, second] = packagedContent.lessons;
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        {
          lesson: first,
          progress: {
            id: `${userId}:${first.id}`,
            userId,
            lessonId: first.id,
            status: 'available',
            bestScore: 40,
            bestStarCount: 0,
            attemptCount: 1,
            xpAwarded: 40,
            firstStartedAt: 1,
            lastAttemptedAt: 2,
            clearedAt: null,
          },
        },
        {
          lesson: second,
          progress: {
            id: `${userId}:${second.id}`,
            userId,
            lessonId: second.id,
            status: 'locked',
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
    });
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
        <LessonsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Needs retry')).toBeVisible();
    expect(screen.getByText('Try lesson again')).toBeVisible();
    expect(screen.getByText('Needs retry').closest('.lesson-node__title-line')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Almanac' })).not.toBeInTheDocument();
  });

  it('renders ordered chapter states below an active lesson without inventing chapter scores', async () => {
    const baseLesson = packagedContent.lessons[0];
    const chapter = {
      id: 'chapter-one',
      title: 'Chapter one',
      description: baseLesson.shortDescription,
      displayOrder: 1,
      instructionalContent: [],
      activities: baseLesson.activities,
    };
    const lesson = {
      ...baseLesson,
      chapters: [chapter, { ...chapter, id: 'chapter-two', title: 'Chapter two', displayOrder: 2 }],
    };
    const activeAttempt = {
      id: '40000000-0000-4000-8000-000000000015', userId, lessonId: lesson.id,
      contentVersion: lesson.contentVersion, status: 'active' as const, startedAt: 1, lastUpdatedAt: 2,
      completedAt: null, abandonedAt: null, answers: [], finalScore: null, starCount: null,
      cleared: null, xpImprovement: 0, flowStage: 'chapter-teaching' as const,
      currentChapterId: 'chapter-two', preAssessmentVersion: null, postAssessmentVersion: null,
    };
    await saveLessonDraft(createLessonDraft(activeAttempt, lesson));
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0], unit: packagedContent.units[0], entries: [{
        lesson,
        progress: { id: `${userId}:${lesson.id}`, userId, lessonId: lesson.id, status: 'in-progress', bestScore: 0, bestStarCount: 0, attemptCount: 0, xpAwarded: 0, firstStartedAt: 1, lastAttemptedAt: 2, clearedAt: null },
      }],
    });
    vi.mocked(getTotalXp).mockResolvedValue(0);
    authenticate();

    render(<MemoryRouter><LessonsPage /></MemoryRouter>);

    const chapters = await screen.findByRole('list', { name: `${lesson.title} chapters` });
    expect(screen.queryByText(/Chapters \(2\)/)).not.toBeInTheDocument();
    expect(chapters).toHaveTextContent('Chapter 1');
    expect(chapters).toHaveTextContent('Chapter one');
    expect(chapters).toHaveTextContent('Completed');
    expect(chapters).toHaveTextContent('Chapter 2');
    expect(chapters).toHaveTextContent('Chapter two');
    expect(chapters).toHaveTextContent('In progress');
    expect(chapters).not.toHaveTextContent(/Score|star/i);
    expect(screen.getByText('Completed').closest('.lesson-chapter__title-line')).not.toBeNull();

    const toggle = screen.getByRole('button', { name: `Hide chapters for ${lesson.title}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.setup().click(toggle);
    expect(screen.queryByRole('list', { name: `${lesson.title} chapters` })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: lesson.title })).toBeVisible();
    expect(screen.getByRole('button', { name: `Show chapters for ${lesson.title}` })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(screen.getByRole('button', { name: `Show chapters for ${lesson.title}` }));
    expect(await screen.findByRole('list', { name: `${lesson.title} chapters` })).toBeVisible();
  });

  it('opens the overview from a completed lesson card instead of bypassing to results', async () => {
    const lesson = packagedContent.lessons[0];
    const completedAttempt = {
      id: '40000000-0000-4000-8000-000000000014',
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed' as const,
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
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [{
        lesson,
        progress: {
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
        },
      }],
    });
    vi.mocked(getTotalXp).mockResolvedValue(100);
    authenticate();

    render(
      <MemoryRouter initialEntries={['/lessons']}>
        <Routes>
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/:lessonId" element={<p>Lesson overview destination</p>} />
          <Route path="/lessons/:lessonId/result/:attemptId" element={<p>Results destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.setup().click(await screen.findByRole('link', { name: /Lesson 1/ }));

    expect(await screen.findByText('Lesson overview destination')).toBeVisible();
    expect(screen.queryByText('Results destination')).not.toBeInTheDocument();
  });

  it('shows a stable empty state when no lessons are published', async () => {
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [],
    });
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

    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'No lessons are currently available' }),
    ).toBeVisible();
    expect(screen.getByRole('list', { name: 'Lesson sequence' })).toBeEmptyDOMElement();
  });

  it('shows a recoverable error instead of loading forever after a rejected request', async () => {
    vi.mocked(getLessonHubData).mockRejectedValue(new Error('offline'));
    vi.mocked(getTotalXp).mockResolvedValue(0);
    authenticate();

    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Lessons unavailable' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('loads the lesson path after retrying a failed request', async () => {
    const hub: LessonHubData = {
      section: { ...packagedContent.sections[0], title: 'Recovered lessons' },
      unit: packagedContent.units[0],
      entries: [],
    };
    vi.mocked(getLessonHubData)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(hub);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    authenticate();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Recovered lessons' })).toBeVisible();
    expect(getLessonHubData).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response after the authenticated user changes', async () => {
    const first = deferred<LessonHubData>();
    const second = deferred<LessonHubData>();
    vi.mocked(getLessonHubData)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    authenticate();
    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );

    const nextUserId = '30000000-0000-4000-8000-000000000003';
    act(() => authenticate(nextUserId));
    await act(async () => {
      second.resolve({
        section: { ...packagedContent.sections[0], title: 'Second account lessons' },
        unit: packagedContent.units[0],
        entries: [],
      });
      await second.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Second account lessons' })).toBeVisible();

    await act(async () => {
      first.resolve({
        section: { ...packagedContent.sections[0], title: 'Stale first account lessons' },
        unit: packagedContent.units[0],
        entries: [],
      });
      await first.promise;
    });
    expect(screen.queryByRole('heading', { name: 'Stale first account lessons' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Second account lessons' })).toBeVisible();
  });
});
