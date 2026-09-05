import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from './content/packaged-content';
import { getLesson } from './content/content.service';
import { getAttempt } from './attempts/attempt.service';
import { ActiveLessonPage } from './ActiveLessonPage';

vi.mock('./content/content.service', () => ({ getLesson: vi.fn() }));
vi.mock('./attempts/attempt.service', () => ({ completeAttempt: vi.fn(), getAttempt: vi.fn(), recordAttemptActiveSeconds: vi.fn().mockResolvedValue(undefined), submitActivityAnswer: vi.fn() }));
vi.mock('@/services/audio/audio.manager', () => ({ playCompletion: vi.fn(), playSfx: vi.fn() }));

describe('active lesson loading failures', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('renders a recoverable error and retries restoration', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: attemptId, userId, lessonId: lesson.id, contentVersion: lesson.contentVersion, status: 'active', startedAt: 1, lastUpdatedAt: 1, completedAt: null, abandonedAt: null, answers: [], finalScore: null, starCount: null, cleared: null, xpImprovement: 0 });
    useAuthStore.setState({ status: 'authenticated', user: { id: userId, normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1 } });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}><Routes><Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Lesson attempt unavailable' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: lesson.activities[0].title })).toBeInTheDocument();
    expect(getAttempt).toHaveBeenCalledTimes(2);
  });
});
