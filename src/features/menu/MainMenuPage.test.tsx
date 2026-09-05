import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { getActiveAttempt } from '@/features/lessons/attempts/attempt.service';
import { getLessonHubData, getTotalXp } from '@/features/lessons/progress/progress.service';
import { MainMenuPage } from './MainMenuPage';

vi.mock('@/features/lessons/attempts/attempt.service', () => ({ getActiveAttempt: vi.fn() }));
vi.mock('@/features/lessons/progress/progress.service', () => ({ getLessonHubData: vi.fn(), getTotalXp: vi.fn() }));
vi.mock('@/services/audio/audio.manager', () => ({ playSfx: vi.fn() }));

const userId = '20000000-0000-4000-8000-000000000002';

describe('main menu loading failures', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('renders a recoverable error and retries the rejected load', async () => {
    const lesson = packagedContent.lessons[0];
    const hub = { section: packagedContent.sections[0], unit: packagedContent.units[0], entries: [{ lesson, progress: { id: `${userId}:${lesson.id}`, userId, lessonId: lesson.id, status: 'available' as const, bestScore: 0, bestStarCount: 0, attemptCount: 0, xpAwarded: 0, firstStartedAt: null, lastAttemptedAt: null, clearedAt: null } }] };
    vi.mocked(getLessonHubData).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(hub);
    vi.mocked(getActiveAttempt).mockResolvedValue(null);
    vi.mocked(getTotalXp).mockResolvedValue(0);
    useAuthStore.setState({ status: 'authenticated', user: { id: userId, normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1 } });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(<MemoryRouter><MainMenuPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Home is unavailable' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: lesson.title })).toBeInTheDocument();
    expect(getLessonHubData).toHaveBeenCalledTimes(2);
  });
});
