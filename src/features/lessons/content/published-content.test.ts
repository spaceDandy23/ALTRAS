import { afterEach, describe, expect, it, vi } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from './packaged-content';
import {
  getAllLessons,
  getLesson,
  initializeContent,
  initializePackagedContent,
} from './content.service';
const client = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));
let database: AltrasDatabase;
afterEach(async () => {
  await database?.delete();
  vi.resetAllMocks();
});
function publicLesson() {
  const lesson = structuredClone(packagedContent.lessons[0]);
  return {
    ...lesson,
    activities: lesson.activities.map((activity) => {
      const safe: Record<string, unknown> = {
        ...activity,
        explanation: {
          title: 'Answer feedback',
          body: 'Submit your answer to see the explanation.',
        },
      };
      delete safe.correctChoiceId;
      delete safe.correctTokenSequence;
      return safe;
    }),
  };
}
describe('authoritative public lesson content', () => {
  it('loads key-free catalog from the server, not the legacy local lesson cache', async () => {
    database = new AltrasDatabase(`catalog-${crypto.randomUUID()}`);
    await initializePackagedContent(database, packagedContent);
    client.rpc.mockResolvedValue({ data: [publicLesson()], error: null });
    const lessons = await getAllLessons(database);
    expect(lessons).toHaveLength(1);
    expect(JSON.stringify(lessons)).not.toMatch(/correctChoiceId|correctTokenSequence/);
    expect(client.rpc).toHaveBeenCalledWith('get_lesson_catalog');
  });
  it('requests the exact attempt snapshot for the player/results and fails closed on error', async () => {
    database = new AltrasDatabase(`catalog-${crypto.randomUUID()}`);
    client.rpc
      .mockResolvedValueOnce({ data: publicLesson(), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'not allowed' } });
    await getLesson(database, packagedContent.lessons[0].id, 'attempt-id');
    expect(client.rpc).toHaveBeenCalledWith('get_lesson_content', {
      p_lesson_id: packagedContent.lessons[0].id,
      p_attempt_id: 'attempt-id',
    });
    await expect(getLesson(database, packagedContent.lessons[0].id)).rejects.toThrow('unavailable');
  });
  it('removes old key-bearing caches without deleting local assessment drafts', async () => {
    database = new AltrasDatabase(`catalog-${crypto.randomUUID()}`);
    await initializePackagedContent(database, packagedContent);
    // IndexedDB accepts raw stored fixtures; no draft business logic is involved here.
    await database
      .table('assessmentDrafts')
      .put({ id: 'keep-draft', userId: 'learner', answers: { item: 'answer' } });
    const before = await database.assessmentDrafts.toArray();
    await initializeContent(database);
    await initializeContent(database);
    expect(await database.lessons.count()).toBe(0);
    expect(await database.lessonItems.count()).toBe(0);
    expect(await database.assessmentDrafts.toArray()).toEqual(before);
    expect(await database.sections.count()).toBe(1);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
