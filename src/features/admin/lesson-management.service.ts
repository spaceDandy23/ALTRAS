import { z } from 'zod';
import {
  lessonSchema,
  type InstructionalContentBlock,
  type LessonChapter,
} from '@/features/lessons/domain/content.schemas';
import { catalogShell } from '@/features/lessons/content/catalog-shell';
import { getSupabaseClient } from '@/services/supabase.client';
import {
  adminAssessmentQuestionSchema,
  publishableAssessmentSchema,
  type AdminAssessmentQuestion,
} from './assessment-management.service';
import type { AssessmentKind } from '@/types/assessment';

type LegacyAuthoredLesson = z.infer<typeof lessonSchema>;
export const lessonAssessmentQuestionsSchema = z.object({
  'pre-test': z.array(adminAssessmentQuestionSchema).max(100),
  'post-test': z.array(adminAssessmentQuestionSchema).max(100),
});
export type LessonAssessmentQuestions = Record<AssessmentKind, AdminAssessmentQuestion[]>;
export type AuthoredLesson = LegacyAuthoredLesson & {
  chapters: LessonChapter[];
  assessmentQuestions: LessonAssessmentQuestions;
};
export type AuthoredChapter = LessonChapter;
export const MAX_ACTIVITIES = 10;
export const MAX_LESSONS = 8;
export const publishableLessonSchema = lessonSchema.superRefine((lesson, ctx) => {
  if (!lesson.title.trim() || !lesson.shortDescription.trim())
    ctx.addIssue({ code: 'custom', message: 'Title and description are required.' });
  if (lesson.displayOrder < 1) ctx.addIssue({ code: 'custom', message: 'Order must be positive.' });
  if (!lesson.chapters?.length)
    ctx.addIssue({ code: 'custom', message: 'A published lesson requires at least one chapter.' });
  if (lesson.activities.length > MAX_ACTIVITIES)
    ctx.addIssue({ code: 'custom', message: 'A lesson supports at most 10 activities.' });
  for (const activity of lesson.activities) {
    const options = activity.type === 'organize-translate' ? activity.tokens : activity.choices;
    if (options.length > 20)
      ctx.addIssue({ code: 'custom', message: 'Use at most 20 choices or tokens.' });
  }
});

function lessonValidationMessage(error: z.ZodError): string {
  const activityFields = new Map<number, Set<string>>();
  const labels: Record<string, string> = {
    title: 'title',
    prompt: 'instructions',
    mathStatement: 'mathematical expression',
    body: 'feedback explanation',
  };

  for (const issue of error.issues) {
    const path = issue.path;
    const activityIndex = path[0] === 'activities' && typeof path[1] === 'number'
      ? path[1]
      : path[0] === 'chapters' && path[2] === 'activities' && typeof path[3] === 'number'
        ? path[3]
        : null;
    if (activityIndex === null) continue;
    const leaf = [...path].reverse().find((part): part is string => typeof part === 'string');
    const optionCollectionIndex = path.findIndex((part) => part === 'choices' || part === 'tokens');
    const optionIndex = optionCollectionIndex >= 0 ? path[optionCollectionIndex + 1] : undefined;
    const field = typeof optionIndex === 'number'
      ? `${path[optionCollectionIndex] === 'tokens' ? 'token' : 'choice'} ${optionIndex + 1} text`
      : leaf === 'title' && path.includes('explanation')
        ? 'feedback title'
        : leaf && labels[leaf]
          ? labels[leaf]
          : leaf === 'label'
            ? 'choice or token text'
            : issue.message;
    const fields = activityFields.get(activityIndex) ?? new Set<string>();
    fields.add(field);
    activityFields.set(activityIndex, fields);
  }

  if (activityFields.size > 0) {
    const details = [...activityFields.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, fields]) => `Activity ${index + 1}: ${[...fields].join(', ')}`);
    return `Complete the required fields before publishing. ${details.join('; ')}.`;
  }

  return [...new Set(error.issues.map((issue) => issue.message))].join(' ');
}
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
  return ((await call('get_admin_lessons')) as ManagedLesson[]).map((item) => ({
    ...item,
    draft: normalizeAuthoredLesson(item.draft),
  }));
}
export async function saveManagedLesson(
  draft: AuthoredLesson,
  revision: number,
): Promise<ManagedLesson> {
  const normalized = normalizeAuthoredLesson(draft);
  if (normalized.activities.length > MAX_ACTIVITIES)
    throw new Error('A lesson supports at most 10 activities.');
  lessonAssessmentQuestionsSchema.parse(normalized.assessmentQuestions);
  return (await call('save_admin_lesson', {
    p_lesson: normalized,
    p_revision: revision,
  })) as ManagedLesson;
}
export async function publishManagedLesson(
  item: ManagedLesson,
  published: boolean,
): Promise<ManagedLesson> {
  if (published) {
    try {
      publishableLessonSchema.parse(item.draft);
    } catch (cause) {
      if (cause instanceof z.ZodError)
        throw new Error(lessonValidationMessage(cause), { cause });
      throw cause;
    }
    for (const assessment of ['pre-test', 'post-test'] as const) {
      const enabled =
        assessment === 'pre-test'
          ? item.draft.assessments?.preTest === 'pre-test'
          : item.draft.assessments?.postTest === 'post-test';
      if (enabled)
        publishableAssessmentSchema.parse({
          assessment,
          questions: item.draft.assessmentQuestions[assessment],
        });
    }
  }
  return (await call('set_lesson_publication', {
    p_lesson_id: item.lesson_id,
    p_publish: published,
    p_revision: item.revision,
  })) as ManagedLesson;
}
export function newLesson(order: number): AuthoredLesson {
  return normalizeAuthoredLesson({
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
    chapters: [newChapter(1)],
    assessments: { preTest: 'pre-test', postTest: 'post-test' },
    assessmentQuestions: { 'pre-test': [], 'post-test': [] },
  });
}

export function newChapter(order: number, title = `Chapter ${order}`): AuthoredChapter {
  return {
    id: `chapter-${crypto.randomUUID()}`,
    title,
    description: '',
    displayOrder: order,
    instructionalContent: [],
    activities: [],
  };
}

export function newInstructionalBlock(
  type: InstructionalContentBlock['type'] = 'paragraph',
): InstructionalContentBlock {
  const id = `content-${crypto.randomUUID()}`;
  if (type === 'example') return { id, type, phrase: '', expression: '', note: '' };
  if (type === 'vocabulary-table')
    return {
      id,
      type,
      title: 'Vocabulary',
      rows: [{ id: `reference-${crypto.randomUUID()}`, term: '', definition: '', example: '' }],
    };
  return { id, type, title: '', body: '' };
}

export function normalizeAuthoredLesson(
  lesson: LegacyAuthoredLesson & { assessmentQuestions?: LessonAssessmentQuestions },
): AuthoredLesson {
  const source = lesson.chapters?.length
    ? lesson.chapters
    : [
        {
          id: `chapter-${lesson.id}`,
          title: 'Chapter 1',
          description: lesson.shortDescription,
          displayOrder: 1,
          instructionalContent: lesson.instructionalContent,
          activities: lesson.activities,
        },
      ];
  const chapters = [...source]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((chapter, index) => ({ ...chapter, displayOrder: index + 1 }));
  return {
    ...lesson,
    chapters,
    instructionalContent: chapters.flatMap((chapter) => chapter.instructionalContent),
    activities: chapters.flatMap((chapter) => chapter.activities),
    assessmentQuestions: lesson.assessmentQuestions ?? { 'pre-test': [], 'post-test': [] },
  };
}

export function totalLessonActivities(lesson: Pick<AuthoredLesson, 'chapters'>): number {
  return lesson.chapters.reduce((total, chapter) => total + chapter.activities.length, 0);
}
export function newActivity(
  type: 'find-word' | 'organize-translate' | 'choose-correct-translation',
): AuthoredLesson['activities'][number] {
  const base = {
    id: `activity-${crypto.randomUUID()}`,
    title: '',
    prompt: '',
    explanation: { title: '', body: '' },
  };
  if (type === 'choose-correct-translation')
    return {
      ...base,
      type,
      choices: [
        { id: 'choice-1', label: '' },
        { id: 'choice-2', label: '' },
      ],
      correctChoiceId: 'choice-1',
    };
  if (type === 'find-word')
    return {
      ...base,
      type,
      mathStatement: '',
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
    mathStatement: '',
    tokens: [
      { id: 'token-1', label: '' },
      { id: 'token-2', label: '' },
    ],
    correctTokenSequence: ['token-1', 'token-2'],
    acceptedTokenSequences: [['token-1', 'token-2']],
  };
}
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
