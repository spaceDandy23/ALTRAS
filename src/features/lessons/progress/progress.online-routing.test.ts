import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AltrasDatabase } from '@/db/database';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  lesson: vi.fn(),
  hub: vi.fn(),
  xp: vi.fn(),
}));

vi.mock('./online-progress.service', () => ({
  ensureOnlineLessonProgress: mocks.ensure,
  getOnlineLessonProgress: mocks.lesson,
  getOnlineLessonHubData: mocks.hub,
  getOnlineTotalXp: mocks.xp,
}));

import {
  ensureUserLessonProgress,
  getLessonHubData,
  getLessonProgress,
  getTotalXp,
} from './progress.service';

const database = {} as AltrasDatabase;
const userId = '00000000-0000-4000-8000-000000000001';

describe('Supabase-only lesson progress routing', () => {
  beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

  it('routes all progress reads and initialization to online services', async () => {
    mocks.ensure.mockResolvedValue([]);
    mocks.lesson.mockResolvedValue({ lessonId: 'lesson-one' });
    mocks.hub.mockResolvedValue({ entries: [] });
    mocks.xp.mockResolvedValue(130);

    await ensureUserLessonProgress(database, userId);
    await getLessonProgress(database, userId, 'lesson-one');
    await getLessonHubData(database, userId);
    await expect(getTotalXp(database, userId)).resolves.toBe(130);

    expect(mocks.ensure).toHaveBeenCalledWith(database, userId);
    expect(mocks.lesson).toHaveBeenCalledWith(database, userId, 'lesson-one');
    expect(mocks.hub).toHaveBeenCalledWith(database, userId);
    expect(mocks.xp).toHaveBeenCalledWith(userId);
  });

  it('does not hide authoritative progress failures', async () => {
    mocks.hub.mockRejectedValue(new Error('Unable to load online lesson progress.'));
    await expect(getLessonHubData(database, userId)).rejects.toThrow(
      'Unable to load online lesson progress.',
    );
  });
});
