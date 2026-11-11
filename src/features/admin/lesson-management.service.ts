import { z } from 'zod';
import {
  lessonSchema,
  lessonAttemptLimitSchema,
  unlimitedLessonAttempts,
  type LessonAttemptLimit,
  type InstructionalContentBlock,
  type LessonChapter,
} from '@/features/lessons/domain/content.schemas';
import { newContentTable } from '@/features/lessons/domain/content-tables';
import { catalogShell } from '@/features/lessons/content/catalog-shell';
import { getSupabaseClient } from '@/services/supabase.client';
import {
  adminAssessmentQuestionSchema,
  publishableAssessmentSchema,
  type AdminAssessmentQuestion,
} from './assessment-management.service';
import type { AssessmentKind } from '@/types/assessment';
import type { LessonValidationIssue, ValidationPathPart } from './lesson-validation';

type LegacyAuthoredLesson = z.infer<typeof lessonSchema>;
export const lessonAssessmentQuestionsSchema = z.object({
  'pre-test': z.array(adminAssessmentQuestionSchema).max(100),
  'post-test': z.array(adminAssessmentQuestionSchema).max(100),
});
export type LessonAssessmentQuestions = Record<AssessmentKind, AdminAssessmentQuestion[]>;
export type AuthoredLesson = LegacyAuthoredLesson & {
  attemptLimit: LessonAttemptLimit;
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

function normalizedValidationPath(path: ValidationPathPart[], draft: AuthoredLesson): ValidationPathPart[] {
  if (path[0] === 'activities' && typeof path[1] === 'number') {
    const flattened = draft.chapters.flatMap((chapter, chapterIndex) =>
      chapter.activities.map((activity, activityIndex) => ({ activity, chapterIndex, activityIndex })),
    );
    const location = flattened[path[1]];
    if (location)
      return ['chapters', location.chapterIndex, 'activities', location.activityIndex, ...path.slice(2)];
  }
  if (path[0] === 'instructionalContent' && typeof path[1] === 'number') {
    const flattened = draft.chapters.flatMap((chapter, chapterIndex) =>
      chapter.instructionalContent.map((block, blockIndex) => ({ block, chapterIndex, blockIndex })),
    );
    const location = flattened[path[1]];
    if (location)
      return ['chapters', location.chapterIndex, 'instructionalContent', location.blockIndex, ...path.slice(2)];
  }
  return path;
}

function validationLabel(path: ValidationPathPart[], draft: AuthoredLesson): string {
  const [root, index] = path;
  if (root === 'assessmentQuestions' && (index === 'pre-test' || index === 'post-test')) {
    const kindLabel = index === 'pre-test' ? 'Pre-test' : 'Post-test';
    const questionsIndex = path.indexOf('questions');
    const questionIndex = questionsIndex >= 0 && typeof path[questionsIndex + 1] === 'number'
      ? path[questionsIndex + 1] as number
      : typeof path[2] === 'number' ? path[2] as number : undefined;
    const questionLabel = `${kindLabel}${questionIndex === undefined ? '' : ` → Question ${questionIndex + 1}`}`;
    const choicesIndex = path.indexOf('choices');
    if (choicesIndex >= 0 && typeof path[choicesIndex + 1] === 'number')
      return `${questionLabel} → Answer choice ${(path[choicesIndex + 1] as number) + 1}`;
    const field = path.at(-1);
    if (field === 'prompt') return `${questionLabel} → Question text`;
    if (field === 'correctChoiceId') return `${questionLabel} → Correct answer`;
    return `${questionLabel} → Answer choices`;
  }
  if (root === 'chapters' && typeof index === 'number') {
    const collection = path[2];
    const childIndex = path[3];
    const field = path[4];
    const nestedIndex = path[5];
    const leaf = path.at(-1);
    const prefix = `Chapter ${index + 1}`;
    if (collection === 'activities' && typeof childIndex === 'number') {
      if (field === 'choices' && typeof nestedIndex === 'number') return `${prefix} → Activity ${childIndex + 1} → Answer choice ${nestedIndex + 1}`;
      if (field === 'tokens' && typeof nestedIndex === 'number') return `${prefix} → Activity ${childIndex + 1} → Token ${nestedIndex + 1}`;
      if (field === 'acceptedTokenSequences' && typeof nestedIndex === 'number') return `${prefix} → Activity ${childIndex + 1} → Accepted answer ${nestedIndex + 1}`;
      if (field === 'explanation' && leaf === 'title') return `${prefix} → Activity ${childIndex + 1} → Feedback title`;
      if (field === 'explanation' && leaf === 'body') return `${prefix} → Activity ${childIndex + 1} → Feedback explanation`;
      const activityField = field === 'title' ? 'Activity title' : field === 'prompt' ? 'Instructions' : field === 'mathStatement' ? 'Mathematical expression' : field === 'correctChoiceId' ? 'Correct answer' : field === 'choices' ? 'Answer choices' : field === 'tokens' ? 'Phrase tokens' : String(field ?? 'Activity');
      return `${prefix} → Activity ${childIndex + 1} → ${activityField}`;
    }
    if (collection === 'instructionalContent' && typeof childIndex === 'number') {
      const block = draft.chapters[index]?.instructionalContent[childIndex];
      const blockName = block?.type === 'content-table' ? 'Teaching Content → Dynamic Tables' : block?.type === 'example' ? 'Teaching Content → Example' : block?.type === 'warning' ? 'Teaching Content → Important Note' : block?.type === 'vocabulary-table' ? 'Teaching Content → Vocabulary' : 'Teaching Content';
      if (field === 'tables' && typeof nestedIndex === 'number') {
        const tablePath = `${prefix} → ${blockName} → Table ${nestedIndex + 1}`;
        const columnsIndex = path.indexOf('columns');
        if (columnsIndex >= 0 && typeof path[columnsIndex + 1] === 'number') return `${tablePath} → Column ${(path[columnsIndex + 1] as number) + 1}`;
        const rowsIndex = path.indexOf('rows');
        if (rowsIndex >= 0 && typeof path[rowsIndex + 1] === 'number') {
          const cellsIndex = path.indexOf('cells');
          const columnId = cellsIndex >= 0 ? path[cellsIndex + 1] : undefined;
          const column = block?.type === 'content-table'
            ? block.tables[nestedIndex]?.columns.find((item) => item.id === columnId)
            : undefined;
          return `${tablePath} → Row ${(path[rowsIndex + 1] as number) + 1}${column ? ` → ${column.label}` : ''}`;
        }
        return tablePath;
      }
      return `${prefix} → ${blockName}${field ? ` → ${String(field)}` : ''}`;
    }
    const chapterField = collection === 'title' ? 'Chapter title' : collection === 'description' ? 'Chapter description' : collection === 'displayOrder' ? 'Chapter order' : 'Chapter content';
    return `${prefix} → ${chapterField}`;
  }
  const labels: Record<string, string> = {
    title: 'Lesson title', shortDescription: 'Short description', displayOrder: 'Lesson order',
    passingThreshold: 'Passing score', prerequisiteLessonId: 'Prerequisite', concepts: 'Lesson concepts',
    sectionId: 'Lesson section', unitId: 'Lesson unit', contentStatus: 'Lesson availability',
    contentVersion: 'Lesson content version',
    attemptLimit: 'Lesson attempt limit',
  };
  if (root === 'attemptLimit') {
    if (path.includes('maxAttempts')) return 'Maximum lesson attempts';
    return 'Lesson attempt limit';
  }
  if (root === 'title' || root === 'shortDescription' || root === 'displayOrder' || root === 'passingThreshold' || root === 'prerequisiteLessonId') return labels[String(root)];
  if (root === 'activities' || root === 'instructionalContent') return 'Lesson content';
  return 'Lesson settings';
}

function friendlyValidationMessage(path: ValidationPathPart[], message: string): string {
  const leaf = String(path.at(-1) ?? '');
  const isColumnLabel = leaf === 'label' && path.includes('columns');
  const isChoiceLabel = leaf === 'label' && (path.includes('choices') || path.includes('tokens'));
  const isPrompt = leaf === 'prompt' || path.includes('prompt');
  const isTitle = leaf === 'title';
  if (message === 'Invalid input') return 'Choose a valid value.';
  if (/Too small|at least 1 character|too_small/i.test(message)) {
    if (isColumnLabel) return 'Column name is required.';
    if (isChoiceLabel) return 'Answer option is required.';
    if (isPrompt) return 'Question or instruction text is required.';
    if (path.includes('explanation') && leaf === 'title') return 'Feedback title is required.';
    if (path.includes('explanation') && leaf === 'body') return 'Feedback explanation is required.';
    if (leaf === 'shortDescription') return 'Short description is required.';
    if (leaf === 'mathStatement' || leaf === 'expression') return 'Mathematical expression is required.';
    if (leaf === 'phrase') return 'Example phrase is required.';
    if (leaf === 'body') return 'Teaching content is required.';
    if (leaf === 'note') return 'Explanation is required.';
    if (leaf === 'label') return 'Text is required.';
    if (isTitle) return 'Title is required.';
    return 'This field is required.';
  }
  if (leaf === 'maxAttempts' || path.includes('attemptLimit')) {
    return 'Enter a positive whole number of attempts, or choose Unlimited.';
  }
  if (message === 'Each accepted answer must use every token exactly once.') return 'Use every available token exactly once.';
  if (message === 'Accepted answers must use different token orders.') return 'This answer duplicates another accepted order.';
  if (message.includes('needs a correct answer') || message.includes('correct choice must exist')) return 'Select the correct answer.';
  if (message.includes('needs two choices')) return 'Add at least two answer options.';
  if (message.includes('needs text')) return 'Question text is required.';
  if (message.includes('Add at least one question')) return 'Add at least one question before publishing.';
  return message;
}

export function lessonValidationIssues(
  error: z.ZodError,
  draft: AuthoredLesson,
  pathPrefix: ValidationPathPart[] = [],
): LessonValidationIssue[] {
  const unique = new Map<string, LessonValidationIssue>();
  for (const issue of error.issues) {
    if (issue.path.length === 0 && issue.message === 'Title and description are required.') {
      if (!draft.title.trim()) unique.set(JSON.stringify(['title']), { path: ['title'], label: 'Lesson title', message: 'Title is required.' });
      if (!draft.shortDescription.trim()) unique.set(JSON.stringify(['shortDescription']), { path: ['shortDescription'], label: 'Short description', message: 'Description is required.' });
      continue;
    }
    const combined = [...pathPrefix, ...issue.path] as ValidationPathPart[];
    if (combined[0] === 'assessmentQuestions' && combined[2] === 'questions') combined.splice(2, 1);
    if (combined[0] === 'assessmentQuestions') {
      const kind = combined[1];
      const questionIndex = typeof combined[2] === 'number' ? combined[2] as number : undefined;
      const question = kind === 'pre-test' || kind === 'post-test'
        ? draft.assessmentQuestions[kind][questionIndex ?? -1]
        : undefined;
      if (issue.message.includes('needs a correct answer')) combined.push('correctChoiceId');
      else if (issue.message.includes('needs two choices')) combined.push('choices');
      else if (issue.message.includes('has an empty choice') && question) {
        combined.push('choices', question.choices.findIndex((choice) => !choice.label.trim()), 'label');
      } else if (issue.message.includes('has duplicate choices') && question) {
        const duplicateIndex = question.choices.findIndex((choice, index) => question.choices.some((other, otherIndex) => otherIndex < index && other.id === choice.id));
        combined.push('choices', Math.max(0, duplicateIndex), 'label');
      } else if (issue.message.includes('correct choice must exist')) combined.push('correctChoiceId');
    }
    if (issue.message === 'The correct choice must exist.') combined.push('correctChoiceId');
    if (issue.message === 'Choice IDs must be unique.') combined.push('choices');
    if (issue.message === 'Token IDs must be unique.') combined.push('tokens');
    if (issue.message === 'Each row must contain exactly the configured columns.') {
      const tablePath = combined.slice(0, -1);
      const chapter = tablePath[0] === 'chapters' && typeof tablePath[1] === 'number' ? draft.chapters[tablePath[1]] : undefined;
      const blockIndex = tablePath[0] === 'chapters' && typeof tablePath[1] === 'number' && typeof tablePath[3] === 'number' ? tablePath[3] : undefined;
      const block = blockIndex === undefined || !chapter ? undefined : chapter.instructionalContent[blockIndex];
      const tableIndex = typeof tablePath.at(-1) === 'number' ? tablePath.at(-1) as number : 0;
      const table = block?.type === 'content-table' ? block.tables[tableIndex] : undefined;
      if (table) combined.push('rows', 0, 'cells', table.columns[0]?.id ?? '');
    }
    const path = normalizedValidationPath(combined, draft);
    const key = JSON.stringify(path);
    const message = friendlyValidationMessage(path, issue.message);
    unique.set(key, { path, label: validationLabel(path, draft), message });
  }
  return [...unique.values()];
}

export function getLessonValidationIssues(
  draft: AuthoredLesson,
  operation: 'save' | 'publish',
): LessonValidationIssue[] {
  const issues: LessonValidationIssue[] = [];
  if (!draft.title.trim())
    issues.push({ path: ['title'], label: 'Lesson title', message: 'Title is required.' });
  if (!Number.isInteger(draft.displayOrder) || draft.displayOrder < 1 || draft.displayOrder > 99999)
    issues.push({ path: ['displayOrder'], label: 'Lesson order', message: 'Lesson order must be a positive integer.' });
  if (draft.activities.length > MAX_ACTIVITIES)
    issues.push({ path: ['chapters'], label: 'Lesson activities', message: `A lesson supports at most ${MAX_ACTIVITIES} activities.` });
  try {
    lessonAttemptLimitSchema.parse(draft.attemptLimit);
  } catch (error) {
    if (error instanceof z.ZodError)
      issues.push(...lessonValidationIssues(error, draft, ['attemptLimit']));
  }
  try {
    lessonAssessmentQuestionsSchema.parse(draft.assessmentQuestions);
  } catch (error) {
    if (error instanceof z.ZodError) issues.push(...lessonValidationIssues(error, draft, ['assessmentQuestions']));
  }
  if (operation === 'publish') {
    try {
      publishableLessonSchema.parse(draft);
    } catch (error) {
      if (error instanceof z.ZodError) issues.push(...lessonValidationIssues(error, draft));
    }
    for (const assessment of ['pre-test', 'post-test'] as const) {
      const enabled = assessment === 'pre-test'
        ? draft.assessments?.preTest === 'pre-test'
        : draft.assessments?.postTest === 'post-test';
      if (!enabled) continue;
      try {
        publishableAssessmentSchema.parse({ assessment, questions: draft.assessmentQuestions[assessment] });
      } catch (error) {
        if (error instanceof z.ZodError)
          issues.push(...lessonValidationIssues(error, draft, ['assessmentQuestions', assessment]));
      }
    }
  }
  return [...new Map(issues.map((issue) => [JSON.stringify(issue.path), issue])).values()];
}

export class LessonManagementValidationError extends Error {
  constructor(public readonly issues: LessonValidationIssue[], message = issues[0]?.message ?? 'Lesson fields need attention.') {
    super(message);
    this.name = 'LessonManagementValidationError';
  }
}

function legacyLessonValidationMessage(error: z.ZodError): string {
  const activityFields = new Map<number, Set<string>>();
  const labels: Record<string, string> = { title: 'title', prompt: 'instructions', mathStatement: 'mathematical expression', body: 'feedback explanation' };
  for (const issue of error.issues) {
    const path = issue.path;
    const activityIndex = path[0] === 'activities' && typeof path[1] === 'number'
      ? path[1]
      : path[0] === 'chapters' && path[2] === 'activities' && typeof path[3] === 'number' ? path[3] : null;
    if (activityIndex === null) continue;
    const leaf = [...path].reverse().find((part): part is string => typeof part === 'string');
    const optionCollectionIndex = path.findIndex((part) => part === 'choices' || part === 'tokens');
    const optionIndex = optionCollectionIndex >= 0 ? path[optionCollectionIndex + 1] : undefined;
    const field = typeof optionIndex === 'number'
      ? `${path[optionCollectionIndex] === 'tokens' ? 'token' : 'choice'} ${optionIndex + 1} text`
      : leaf === 'title' && path.includes('explanation') ? 'feedback title'
        : leaf && labels[leaf] ? labels[leaf]
          : leaf === 'label' ? 'choice or token text' : issue.message;
    const fields = activityFields.get(activityIndex) ?? new Set<string>();
    fields.add(field);
    activityFields.set(activityIndex, fields);
  }
  if (activityFields.size > 0) {
    const details = [...activityFields.entries()].sort(([a], [b]) => a - b)
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

interface LessonOrderConflict {
  lessonId: string;
  title: string;
  displayOrder: number;
}

function isLessonOrderConflict(value: unknown): value is LessonOrderConflict {
  if (!value || typeof value !== 'object') return false;
  const conflict = value as Record<string, unknown>;
  return typeof conflict.lessonId === 'string'
    && typeof conflict.title === 'string'
    && typeof conflict.displayOrder === 'number';
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
async function getLessonPublicationOrderConflict(
  lessonId: string,
  displayOrder: number,
): Promise<LessonOrderConflict | null> {
  const conflict = await call('get_admin_lesson_order_conflict', {
    p_lesson_id: lessonId,
    p_display_order: displayOrder,
  });
  return isLessonOrderConflict(conflict) ? conflict : null;
}
export async function saveManagedLesson(
  draft: AuthoredLesson,
  revision: number,
): Promise<ManagedLesson> {
  const normalized = normalizeAuthoredLesson(draft);
  const issues = getLessonValidationIssues(normalized, 'save');
  if (issues.length > 0) throw new LessonManagementValidationError(issues);
  try {
    return (await call('save_admin_lesson', {
      p_lesson: normalized,
      p_revision: revision,
    })) as ManagedLesson;
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Lesson ID and title are required.' && !normalized.title.trim())
      throw new LessonManagementValidationError([{ path: ['title'], label: 'Lesson title', message: 'Title is required.' }]);
    if (cause instanceof Error && cause.message === 'Lesson order must be a positive integer.')
      throw new LessonManagementValidationError([{ path: ['displayOrder'], label: 'Lesson order', message: cause.message }]);
    if (cause instanceof Error && cause.message.includes('Prerequisite'))
      throw new LessonManagementValidationError([{ path: ['prerequisiteLessonId'], label: 'Prerequisite', message: cause.message }]);
    throw cause;
  }
}
export async function publishManagedLesson(
  item: ManagedLesson,
  published: boolean,
): Promise<ManagedLesson> {
  if (published) {
    try {
      publishableLessonSchema.parse(item.draft);
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        const issues = lessonValidationIssues(cause, item.draft);
        throw new LessonManagementValidationError(issues, legacyLessonValidationMessage(cause));
      }
      throw cause;
    }
    for (const assessment of ['pre-test', 'post-test'] as const) {
      const enabled =
        assessment === 'pre-test'
          ? item.draft.assessments?.preTest === 'pre-test'
          : item.draft.assessments?.postTest === 'post-test';
      if (enabled) {
        try {
          publishableAssessmentSchema.parse({
            assessment,
            questions: item.draft.assessmentQuestions[assessment],
          });
        } catch (cause) {
          if (cause instanceof z.ZodError)
            throw new LessonManagementValidationError(lessonValidationIssues(
              cause,
              item.draft,
              ['assessmentQuestions', assessment],
            ));
          throw cause;
        }
      }
    }
    const conflict = await getLessonPublicationOrderConflict(
      item.lesson_id,
      item.draft.displayOrder,
    );
    if (conflict) {
      throw new LessonManagementValidationError([{
        path: ['displayOrder'],
        label: 'Lesson order',
        message: `Lesson order ${item.draft.displayOrder} is already used by "${conflict.title}".`,
      }]);
    }
  }
  try {
    return (await call('set_lesson_publication', {
      p_lesson_id: item.lesson_id,
      p_publish: published,
      p_revision: item.revision,
    })) as ManagedLesson;
  } catch (cause) {
    if (cause instanceof Error && /^Lesson order \d+ is already used by /.test(cause.message)) {
      throw new LessonManagementValidationError([{
        path: ['displayOrder'],
        label: 'Lesson order',
        message: cause.message,
      }]);
    }
    throw cause;
  }
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
    attemptLimit: { ...unlimitedLessonAttempts },
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
  if (type === 'content-table') return { id, type, tables: [newContentTable()] };
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
    attemptLimit: lesson.attemptLimit ?? { ...unlimitedLessonAttempts },
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
