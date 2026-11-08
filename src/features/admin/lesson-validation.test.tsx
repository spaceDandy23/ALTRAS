import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { LessonManagementPage } from './LessonManagementPage';
import {
  normalizeAuthoredLesson,
  publishableLessonSchema,
  getLessonValidationIssues,
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

  it('counts an empty lesson title and empty example phrase as separate fields', () => {
    const draft = validLesson().draft;
    const chapter = draft.chapters[0];
    chapter.instructionalContent = [
      { id: 'example-block', type: 'example', phrase: '', expression: 'n + 5', note: 'This explains the expression.' },
    ];
    draft.title = '';

    const issues = getLessonValidationIssues(draft, 'publish');

    expect(issues.map(({ label }) => label)).toContain('Lesson title');
    expect(issues).toContainEqual(expect.objectContaining({
      path: ['chapters', 0, 'instructionalContent', 0, 'phrase'],
      label: 'Chapter 1 → Teaching Content → Example → phrase',
      message: 'Example phrase is required.',
    }));
    expect(issues).toHaveLength(2);
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
  const activity = row.draft.chapters[0].activities[0];
  row.draft.chapters = [{ ...row.draft.chapters[0], instructionalContent: [], activities: activity ? [activity] : [] }];
  row.draft.activities = activity ? [activity] : [];
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
  fireEvent.change(title, { target: { value: 'Restored title' } });
  await waitFor(() => expect(title).toHaveFocus());
  expect(summary).toHaveTextContent('1 field needs attention');
  expect(screen.getByLabelText('Short description')).toHaveValue('');
}, 30000);

it('catches a blank lesson title before draft save and focuses the title field', async () => {
  const row = validLesson();
  client.rpc.mockImplementation(async (name: string, args?: { p_lesson: AuthoredLesson }) => ({
    error: null,
    data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args?.p_lesson ?? row.draft, revision: 2 },
  }));
  render(<MemoryRouter><LessonManagementPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
  const title = screen.getByLabelText('Lesson title');
  fireEvent.change(title, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  const summary = await screen.findByRole('alert');
  expect(summary).toHaveTextContent('1 field needs attention');
  expect(summary).toHaveTextContent('Lesson title: Title is required.');
  expect(title).toHaveAttribute('aria-invalid', 'true');
  await waitFor(() => expect(title).toHaveFocus());
  expect(title).toHaveValue('');
  expect(client.rpc).not.toHaveBeenCalledWith('save_admin_lesson', expect.anything());
}, 15000);

it('reports all invalid fields when publish validation fails before draft saving', async () => {
  const row = validLesson();
  row.draft.chapters[0].instructionalContent = [{
    id: 'example-block', type: 'example', phrase: 'five more than a number',
    expression: 'n + 5', note: 'This phrase signals addition.',
  }];
  client.rpc.mockImplementation(async (name: string, args?: { p_lesson: AuthoredLesson }) => ({
    error: null,
    data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args?.p_lesson ?? row.draft, revision: 2 },
  }));
  render(<MemoryRouter><LessonManagementPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
  fireEvent.change(screen.getByLabelText('Lesson title'), { target: { value: '' } });
  fireEvent.click(screen.getByText(/Chapter 1:/));
  fireEvent.click(screen.getByText(/Content 1 · Example/));
  fireEvent.change(screen.getByLabelText('Example phrase'), { target: { value: '' } });

  fireEvent.click(screen.getByRole('button', { name: 'Publish lesson' }));

  const summary = await screen.findByRole('alert');
  expect(summary).toHaveTextContent('2 fields need attention');
  expect(summary).toHaveTextContent('Lesson title: Title is required.');
  expect(summary).toHaveTextContent('Example phrase is required.');
}, 15000);
