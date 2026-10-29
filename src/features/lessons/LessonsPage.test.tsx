import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from './content/packaged-content';
import { getLessonHubData, getTotalXp } from './progress/progress.service';
import { LessonsPage } from './LessonsPage';
import type { LessonHubData } from './progress/progress.service';

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
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
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
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
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
