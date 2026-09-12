import { z } from 'zod';
import { lessonSchema } from '@/features/lessons/domain/content.schemas';
import { catalogShell } from '@/features/lessons/content/catalog-shell';
import { getSupabaseClient } from '@/services/supabase.client';

export type AuthoredLesson = z.infer<typeof lessonSchema>;
export const MAX_ACTIVITIES = 10;
export const publishableLessonSchema = lessonSchema.superRefine((lesson, ctx) => {
  if (!lesson.title.trim() || !lesson.shortDescription.trim())
    ctx.addIssue({ code: 'custom', message: 'Title and description are required.' });
  if (lesson.displayOrder < 1) ctx.addIssue({ code: 'custom', message: 'Order must be positive.' });
  if (lesson.activities.length > MAX_ACTIVITIES)
    ctx.addIssue({ code: 'custom', message: 'A lesson supports at most 10 activities.' });
  for (const activity of lesson.activities) {
    const options = activity.type === 'find-word' ? activity.choices : activity.tokens;
    if (options.length > 20)
      ctx.addIssue({ code: 'custom', message: 'Use at most 20 choices or tokens.' });
  }
});
export interface ManagedLesson {
  lesson_id: string;
  draft: AuthoredLesson;
  revision: number;
  published: boolean;
  published_version: number | null;
}

async function call(name: string, args?: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw new Error(error.message || 'Unable to manage lessons.');
  return data;
}
export async function isCurrentUserAdmin(): Promise<boolean> {
  return (await call('is_admin')) === true;
}
export async function listManagedLessons(): Promise<ManagedLesson[]> {
  return (await call('get_admin_lessons')) as ManagedLesson[];
}
export async function saveManagedLesson(
  draft: AuthoredLesson,
  revision: number,
): Promise<ManagedLesson> {
  if (draft.activities.length > MAX_ACTIVITIES)
    throw new Error('A lesson supports at most 10 activities.');
  return (await call('save_admin_lesson', {
    p_lesson: draft,
    p_revision: revision,
  })) as ManagedLesson;
}
export async function publishManagedLesson(
  item: ManagedLesson,
  published: boolean,
): Promise<ManagedLesson> {
  if (published) publishableLessonSchema.parse(item.draft);
  return (await call('set_lesson_publication', {
    p_lesson_id: item.lesson_id,
    p_publish: published,
    p_revision: item.revision,
  })) as ManagedLesson;
}
export function newLesson(order: number): AuthoredLesson {
  return {
    id: `lesson-${crypto.randomUUID()}`,
    sectionId: catalogShell.sections[0].id,
    unitId: catalogShell.units[0].id,
    title: '',
    shortDescription: '',
    displayOrder: order,
    concepts: ['Algebraic expressions'],
    contentStatus: 'playable',
    contentVersion: 1,
    passingThreshold: 70,
    instructionalContent: [],
    activities: [],
  };
}
export function newActivity(
  type: 'find-word' | 'organize-translate',
): AuthoredLesson['activities'][number] {
  const base = {
    id: `activity-${crypto.randomUUID()}`,
    title: '',
    prompt: '',
    mathStatement: '',
    explanation: { title: '', body: '' },
  };
  if (type === 'find-word')
    return {
      ...base,
      type,
      sentenceBefore: '',
      sentenceAfter: '',
      choices: [
        { id: 'choice-1', label: '' },
        { id: 'choice-2', label: '' },
      ],
      correctChoiceId: 'choice-1',
    };
  return {
    ...base,
    type,
    tokens: [
      { id: 'token-1', label: '' },
      { id: 'token-2', label: '' },
    ],
    correctTokenSequence: ['token-1', 'token-2'],
  };
}
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
