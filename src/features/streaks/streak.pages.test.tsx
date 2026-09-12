import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { MainMenuPage } from '@/features/menu/MainMenuPage';
import { LessonResultPage } from '@/features/lessons/LessonResultPage';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import type { LessonAttempt, LessonProgress } from '@/types/learning';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getAttempt: vi.fn(),
  getHub: vi.fn(),
  completion: vi.fn(),
  reward: vi.fn(),
}));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/features/lessons/attempts/attempt.service', () => ({
  getAttempt: mocks.getAttempt,
  getActiveAttempt: async () => null,
  startOrResumeAttempt: vi.fn(),
}));
vi.mock('@/features/lessons/content/content.service', () => ({
  getLesson: async () => packagedContent.lessons[0],
}));
vi.mock('@/features/lessons/progress/progress.service', () => ({
  getLessonHubData: mocks.getHub,
  getTotalXp: async () => 130,
}));
vi.mock('@/services/audio/audio.manager', () => ({
  playCompletion: mocks.completion,
  playReward: mocks.reward,
  playSfx: vi.fn(),
}));

const userId = '20000000-0000-4000-8000-000000000002';
const lesson = packagedContent.lessons[0];
const attempt: LessonAttempt = {
  id: '10000000-0000-4000-8000-000000000001',
  userId,
  lessonId: lesson.id,
  contentVersion: lesson.contentVersion,
  status: 'completed',
  startedAt: 1,
  lastUpdatedAt: 2,
  completedAt: 2,
  abandonedAt: null,
  finalScore: 100,
  starCount: 3,
  cleared: true,
  xpImprovement: 130,
  answers: [],
};
const progress: LessonProgress = {
  id: `${userId}:${lesson.id}`,
  userId,
  lessonId: lesson.id,
  status: 'cleared',
  bestScore: 100,
  bestStarCount: 3,
  attemptCount: 1,
  xpAwarded: 130,
  firstStartedAt: 1,
  lastAttemptedAt: 2,
  clearedAt: 2,
};
const hub = {
  section: packagedContent.sections[0],
  unit: packagedContent.units[0],
  entries: [{ lesson, progress }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: {
      user_id: userId,
      current_streak: 2,
      longest_streak: 2,
      last_activity_date: '2026-09-12',
      earned_today: true,
      celebrate: true,
      calendar_timezone: 'Asia/Manila',
      refresh_after_seconds: 3600,
    },
    error: null,
  });
  mocks.getAttempt.mockResolvedValue(attempt);
  mocks.getHub.mockResolvedValue(hub);
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
  useResearcherAccessStore.setState({ status: 'denied', userId });
  useContentStore.setState({ status: 'ready' });
});
afterEach(() => {
  useAuthStore.setState({ status: 'guest', user: null });
  useResearcherAccessStore.getState().clear();
  useContentStore.setState({ status: 'idle' });
});

describe('streak page integration', () => {
  it('Home displays the authoritative streak alongside existing learning progress', async () => {
    render(
      <MemoryRouter>
        <MainMenuPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('2 day streak')).toBeVisible();
    expect(screen.getByText('130 XP')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review lesson' })).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith('get_student_streak', { p_attempt_id: null });
    expect(screen.queryByText('2 day streak!')).not.toBeInTheDocument();
  });

  it('claims feedback only after the final result renders, preserving perfect-result reward audio', async () => {
    let finish!: (value: typeof hub) => void;
    mocks.getHub.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attempt.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Loading your result/)).toBeVisible();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reward).not.toHaveBeenCalled();
    await act(async () => {
      finish(hub);
    });
    expect(await screen.findByText('2 day streak!')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith('get_student_streak', { p_attempt_id: attempt.id });
    expect(mocks.reward).toHaveBeenCalledWith(attempt.id);
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('does not claim feedback when lesson result data fails to load', async () => {
    mocks.getHub.mockRejectedValue(new Error('offline'));
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attempt.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Result unavailable' })).toBeVisible();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reward).not.toHaveBeenCalled();
  });
});
