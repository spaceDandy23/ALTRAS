import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import { db } from '@/db/database';
import { AdminRoute } from './AdminRoute';
import { LessonManagementPage } from './LessonManagementPage';
import { LessonContentPreview } from './LessonContentPreview';
import {
  MAX_ACTIVITIES,
  newActivity,
  publishManagedLesson,
  saveManagedLesson,
  type ManagedLesson,
} from './lesson-management.service';

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));
const item = (): ManagedLesson => ({
  lesson_id: packagedContent.lessons[0].id,
  draft: structuredClone(packagedContent.lessons[0]),
  revision: 1,
  published: true,
  published_version: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  applyExperienceScope('neutral');
  client.rpc.mockImplementation(
    async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
      error: null,
      data:
        name === 'get_admin_lessons'
          ? [item()]
          : name === 'save_admin_lesson'
            ? { ...item(), draft: args!.p_lesson, revision: 2 }
            : name === 'is_admin'
              ? true
              : { ...item(), revision: 3 },
    }),
  );
});
afterEach(() => {
  useAuthStore.setState({ user: null, status: 'guest' });
  applyExperienceScope('neutral');
});
const page = () =>
  render(
    <MemoryRouter>
      <LessonManagementPage />
    </MemoryRouter>,
  );

describe('Basic Lesson Management editor and preview', () => {
  it('lists metadata and saves a changed draft without publishing it', async () => {
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: `Edit ${item().draft.title}` }));
    fireEvent.change(screen.getByLabelText('Lesson title'), { target: { value: 'Updated draft' } });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith(
      'save_admin_lesson',
      expect.objectContaining({
        p_revision: 1,
        p_lesson: expect.objectContaining({ title: 'Updated draft' }),
      }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith('set_lesson_publication', expect.anything());
  });
  it('blocks activity eleven in the editor', async () => {
    const row = item();
    row.draft.activities = Array.from({ length: 9 }, () => newActivity('find-word'));
    client.rpc.mockResolvedValue({ data: [row], error: null });
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    // Avoid a computed-style accessibility-tree traversal of ten full editors in jsdom.
    const add = screen.getByText('Add activity', { selector: 'button' });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getAllByLabelText('Activity title')).toHaveLength(MAX_ACTIVITIES);
    fireEvent.click(add);
    expect(screen.getAllByLabelText('Activity title')).toHaveLength(MAX_ACTIVITIES);
  });
  it('creates a draft, edits, reorders and deletes activities', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Create lesson' }));
    const add = screen.getByRole('button', { name: 'Add activity' });
    fireEvent.click(add);
    fireEvent.click(add);
    const activities = screen.getAllByLabelText('Activity title');
    fireEvent.change(activities[0], { target: { value: 'First' } });
    fireEvent.change(activities[1], { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move activity 2 up' }));
    expect(screen.getAllByLabelText('Activity title')[0]).toHaveValue('Second');
    fireEvent.click(screen.getByRole('button', { name: 'Delete activity 1' }));
    expect(screen.getAllByLabelText('Activity title')[0]).toHaveValue('First');
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeEnabled();
    fireEvent.change(screen.getAllByLabelText('Activity type')[0], {
      target: { value: 'organize-translate' },
    });
    expect(screen.getByRole('group', { name: 'Correct token order' })).toBeInTheDocument();
  });
  it('rejects eleven activities in the service before any RPC', async () => {
    const draft = {
      ...item().draft,
      activities: Array.from({ length: 11 }, () => newActivity('find-word')),
    };
    await expect(saveManagedLesson(draft, 0)).rejects.toThrow('at most 10');
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('publishes/unpublishes only through the guarded publication RPC', async () => {
    await publishManagedLesson(item(), true);
    await publishManagedLesson(item(), false);
    expect(client.rpc).toHaveBeenCalledWith('set_lesson_publication', {
      p_lesson_id: item().lesson_id,
      p_publish: true,
      p_revision: 1,
    });
    expect(client.rpc).toHaveBeenCalledWith('set_lesson_publication', {
      p_lesson_id: item().lesson_id,
      p_publish: false,
      p_revision: 1,
    });
  });
  it('previews real renderers with no remote calls or local learning writes', async () => {
    const before = await Promise.all(db.tables.map((t) => t.count()));
    const user = userEvent.setup();
    render(<LessonContentPreview lesson={item().draft} />);
    const activity = screen
      .getByRole('heading', { name: item().draft.activities[0].title })
      .closest('.activity-card')! as HTMLElement;
    await user.click(within(activity).getByRole('radio', { name: 'sum' }));
    await user.click(within(activity).getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText(/^Correct\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next activity' }));
    expect(screen.getByText('Activity 2 of 6')).toBeInTheDocument();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(before);
  });
  it.each([false, true])(
    'waits for server admin membership before rendering (allowed=%s)',
    async (allowed) => {
      useAuthStore.setState({
        status: 'authenticated',
        user: {
          id: '10000000-0000-4000-8000-000000000001',
          normalizedUsername: 'author',
          displayName: 'Author',
          createdAt: 1,
          lastLoginAt: 1,
        },
      });
      let resolve!: (value: unknown) => void;
      client.rpc.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      applyExperienceScope('student');
      render(
        <MemoryRouter>
          <AdminRoute>
            <h1>Private editor</h1>
          </AdminRoute>
        </MemoryRouter>,
      );
      expect(screen.queryByText('Private editor')).not.toBeInTheDocument();
      expect(document.documentElement.dataset.experience).toBe('neutral');
      await act(async () => resolve({ data: allowed, error: null }));
      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            name: allowed ? 'Private editor' : 'Admin access required',
          }),
        ).toBeInTheDocument(),
      );
      expect(client.rpc).toHaveBeenCalledWith('is_admin', undefined);
    },
  );
});
