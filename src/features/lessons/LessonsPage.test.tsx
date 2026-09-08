import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from './content/packaged-content';
import { getLessonHubData, getTotalXp } from './progress/progress.service';
import { LessonsPage } from './LessonsPage';

vi.mock('./progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
  getTotalXp: vi.fn(),
}));

const userId = '20000000-0000-4000-8000-000000000002';

describe('lesson hub authoritative progress', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
});
