import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonsPage } from '@/features/lessons/LessonsPage';
import { MainMenuPage } from '@/features/menu/MainMenuPage';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { getActiveAttempt } from '@/features/lessons/attempts/attempt.service';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { getLessonHubData, getTotalXp } from '@/features/lessons/progress/progress.service';

vi.mock('@/features/lessons/attempts/attempt.service', () => ({ getActiveAttempt: vi.fn() }));
vi.mock('@/features/lessons/progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
  getTotalXp: vi.fn(),
}));

const userId = '30000000-0000-4000-8000-000000000003';
const hub = {
  section: packagedContent.sections[0],
  unit: packagedContent.units[0],
  entries: packagedContent.lessons.map((lesson, index) => ({
    lesson,
    progress: {
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: index === 0 ? ('available' as const) : ('locked' as const),
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    },
  })),
};

describe('Word list navigation', () => {
  beforeEach(() => {
    vi.mocked(getLessonHubData).mockResolvedValue(hub);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'navigation_reader',
        displayName: 'Navigation Reader',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('does not place Almanac or Word list actions on the main screen', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainMenuPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Words That Signal Operations' });
    expect(screen.queryByRole('link', { name: 'Almanac' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Word list' })).not.toBeInTheDocument();
  });

  it('opens Almanac from the lesson hub', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lessons']}>
        <Routes>
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/almanac" element={<p>Almanac destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('link', { name: 'Almanac' }));
    expect(screen.getByText('Almanac destination')).toBeVisible();
  });
});
