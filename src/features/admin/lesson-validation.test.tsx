import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { LessonManagementPage } from './LessonManagementPage';
import {
  normalizeAuthoredLesson,
  publishableLessonSchema,
  type AuthoredLesson,
  type ManagedLesson,
  lessonValidationIssues,
} from './lesson-management.service';

const client = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));

function validLesson(): ManagedLesson {
  const draft = normalizeAuthoredLesson(structuredClone(packagedContent.lessons[0]));
  draft.assessments = { preTest: 'pre-test', postTest: 'post-test' };
  const question = (id: string) => ({
    id, prompt: `Question ${id}`,
    choices: [{ id: `${id}-a`, label: 'First' }, { id: `${id}-b`, label: 'Second' }],
    correctChoiceId: `${id}-a`, isPlaceholder: false,
  });
  draft.assessmentQuestions = { 'pre-test': [question('pre')], 'post-test': [question('post')] };
  return { lesson_id: draft.id, draft, revision: 1, published: true, published_version: 1 };
}

describe('lesson CMS validation paths', () => {
  it('maps one invalid setting to its researcher-facing label and message', () => {
    const draft = validLesson().draft;
    const invalid = { ...draft, title: '' };
    const parsed = publishableLessonSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(lessonValidationIssues(parsed.error, invalid)).toContainEqual({
      path: ['title'], label: 'Lesson title', message: 'Title is required.',
    });
  });

  it('reports multiple invalid settings without exposing raw schema paths', () => {
    const draft = { ...validLesson().draft, title: '', shortDescription: '' };
    const parsed = publishableLessonSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = lessonValidationIssues(parsed.error, draft);
    expect(issues.map(({ label }) => label)).toEqual(['Lesson title', 'Short description']);
    expect(issues.some((issue) => issue.label.includes('.'))).toBe(false);
  });

  it('translates nested activity, table-column, and assessment question errors', () => {
    const draft: AuthoredLesson = validLesson().draft;
    draft.chapters[0].instructionalContent = [{
      id: 'table-block', type: 'content-table', tables: [{
        id: 'table-one', title: '', columns: [{ id: 'col-one', label: '' }], rows: [],
      }],
    }];
    draft.chapters[0].activities[0].title = '';
    draft.assessmentQuestions['pre-test'][0].prompt = '';
    const parsed = publishableLessonSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = lessonValidationIssues(parsed.error, draft);
    expect(issues.map((issue) => issue.label)).toContain('Chapter 1 → Teaching Content → Dynamic Tables → Table 1 → Column 1');
    expect(issues.map((issue) => issue.label)).toContain('Chapter 1 → Activity 1 → Activity title');
    const assessment = lessonValidationIssues(
      awaitableAssessmentError(), draft, ['assessmentQuestions', 'pre-test'],
    );
    expect(assessment.some((issue) => issue.path.join('/') === 'assessmentQuestions/pre-test/0/prompt')).toBe(true);
    expect(assessment.some((issue) => issue.label === 'Pre-test → Question 1 → Question text')).toBe(true);
  });
});

// Produce the same question-shape failure that publication reports, without coupling to a page request.
function awaitableAssessmentError() {
  const issue = {
    code: 'too_small', path: ['questions', 0, 'prompt'], message: 'Too small: expected string to have >=1 characters',
    minimum: 1, origin: 'string', inclusive: true,
  } as const;
  return new ZodError([issue as never]);
}

it('shows a prominent multi-field summary, focuses the first invalid field, and keeps entered values', async () => {
  const row = validLesson();
  const clientLesson = { ...row.draft, title: '', shortDescription: '' };
  client.rpc.mockImplementation(async (name: string, args?: { p_lesson: AuthoredLesson }) => ({
    error: null,
    data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args?.p_lesson ?? clientLesson, revision: 2 },
  }));
  render(<MemoryRouter><LessonManagementPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
  fireEvent.change(screen.getByLabelText('Lesson title'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Short description'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish lesson' }));

  const summary = await screen.findByRole('alert');
  expect(summary).toHaveClass('admin-validation-summary');
  expect(summary).toHaveTextContent('2 fields need attention');
  expect(summary).toHaveTextContent('Review the highlighted fields below.');
  const title = screen.getByLabelText('Lesson title');
  expect(title).toHaveAttribute('aria-invalid', 'true');
  expect(title.closest('.form-field')).toHaveTextContent('Title is required.');
  await waitFor(() => expect(title).toHaveFocus());
  expect(title).toHaveValue('');
  expect(screen.getByLabelText('Short description')).toHaveValue('');
}, 15000);
