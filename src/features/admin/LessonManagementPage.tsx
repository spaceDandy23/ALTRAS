import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { FormField } from '@/components/ui/FormField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import { ActivityEditor } from './ActivityEditor';
import { LessonContentPreview } from './LessonContentPreview';
import {
  listManagedLessons,
  saveManagedLesson,
  publishManagedLesson,
  newLesson,
  newActivity,
  moveItem,
  MAX_ACTIVITIES,
  type AuthoredLesson,
  type ManagedLesson,
} from './lesson-management.service';
import './lesson-management.css';

export function LessonManagementPage() {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [items, setItems] = useState<ManagedLesson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<AuthoredLesson | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [leaving, setLeaving] = useState<'list' | 'logout' | null>(null);
  useEffect(() => {
    let active = true;
    void listManagedLessons()
      .then((rows) => {
        if (active) {
          setItems(rows);
          setLoaded(true);
          setError('');
        }
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [reload]);
  const current = items.find((item) => item.lesson_id === draft?.id);
  const change = (next: AuthoredLesson) => {
    setDraft(next);
    setDirty(true);
    setNotice('');
  };
  const accept = (item: ManagedLesson) => {
    setItems((rows) =>
      [...rows.filter((row) => row.lesson_id !== item.lesson_id), item].sort(
        (a, b) => a.draft.displayOrder - b.draft.displayOrder,
      ),
    );
    setDraft(item.draft);
    setRevision(item.revision);
    setDirty(false);
  };
  const save = async (publish?: boolean) => {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = dirty || !current ? await saveManagedLesson(draft, revision) : current;
      accept(saved);
      if (publish !== undefined) accept(await publishManagedLesson(saved, publish));
      setNotice(
        publish === undefined
          ? 'Draft saved.'
          : publish
            ? 'Lesson published.'
            : 'Lesson unpublished. Existing attempts remain saved.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save lesson.');
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    if (leaving === 'logout')
      void logout()
        .then(() => navigate('/login'))
        .catch((e: Error) => setError(e.message));
    else {
      setDraft(null);
      setPreview(false);
      setDirty(false);
      setError('');
      setNotice('');
    }
    setLeaving(null);
  };
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <AltrasLogo />
        <nav aria-label="Admin navigation">
          <strong>Lesson management</strong>
          <Link to="/">Home</Link>
          <button onClick={() => setLeaving('logout')}>Log out</button>
        </nav>
      </header>
      <main className="admin-content">
        <p className="researcher-kicker">Administrator workspace</p>
        <h1>Basic Lesson Management</h1>
        <p>Create and publish lessons in Operation Words. Maximum 10 activities per lesson.</p>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!loaded ? (
          <p role="status">Loading lessons…</p>
        ) : !draft ? (
          <>
            <div className="admin-actions">
              <button
                className="button"
                onClick={() => {
                  setDraft(newLesson(Math.max(0, ...items.map((i) => i.draft.displayOrder)) + 1));
                  setRevision(0);
                  setDirty(true);
                  setNotice('');
                }}
              >
                Create lesson
              </button>
              <button className="button button--quiet" onClick={() => setReload(reload + 1)}>
                Refresh list
              </button>
            </div>
            <div className="admin-table">
              <table>
                <caption>Lessons</caption>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Order</th>
                    <th>State</th>
                    <th>Activities</th>
                    <th>Prerequisite</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.lesson_id}>
                      <td>{item.draft.title}</td>
                      <td>{item.draft.displayOrder}</td>
                      <td>
                        {item.published
                          ? 'Published (editable draft)'
                          : item.published_version
                            ? 'Unpublished'
                            : 'Draft'}
                      </td>
                      <td>{item.draft.activities.length}/10</td>
                      <td>
                        {items.find((p) => p.lesson_id === item.draft.prerequisiteLessonId)?.draft
                          .title ?? 'None'}
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setDraft(structuredClone(item.draft));
                            setRevision(item.revision);
                            setDirty(false);
                            setError('');
                            setNotice('');
                          }}
                        >
                          Edit {item.draft.title}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="admin-actions">
              <button
                className="button button--quiet"
                disabled={busy}
                onClick={() => (dirty ? setLeaving('list') : (setDraft(null), setPreview(false)))}
              >
                Back to lessons
              </button>
              <button className="button button--quiet" onClick={() => setPreview(!preview)}>
                {preview ? 'Return to editor' : 'Preview lesson'}
              </button>
              <span>
                {dirty ? 'Unsaved changes' : 'Saved draft'} ·{' '}
                {current?.published
                  ? 'Live lesson stays unchanged until publishing'
                  : 'Not visible to students'}
              </span>
            </div>
            {preview ? (
              <LessonContentPreview key={draft.id} lesson={draft} />
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy} className="admin-editor">
                  <legend>{current ? 'Edit lesson' : 'Create lesson'}</legend>
                  <div className="admin-fields">
                    <FormField
                      label="Lesson title"
                      value={draft.title}
                      maxLength={2000}
                      required
                      onChange={(e) => change({ ...draft, title: e.target.value })}
                    />
                    <FormField
                      label="Short description"
                      value={draft.shortDescription}
                      maxLength={2000}
                      onChange={(e) => change({ ...draft, shortDescription: e.target.value })}
                    />
                    <FormField
                      label="Lesson order"
                      type="number"
                      min={1}
                      max={99999}
                      value={draft.displayOrder}
                      onChange={(e) => change({ ...draft, displayOrder: Number(e.target.value) })}
                    />
                    <FormField
                      label="Passing score (%)"
                      type="number"
                      min={0}
                      max={100}
                      value={draft.passingThreshold}
                      onChange={(e) =>
                        change({ ...draft, passingThreshold: Number(e.target.value) })
                      }
                    />
                    <label>
                      Prerequisite
                      <select
                        value={draft.prerequisiteLessonId ?? ''}
                        onChange={(e) =>
                          change({ ...draft, prerequisiteLessonId: e.target.value || undefined })
                        }
                      >
                        <option value="">None</option>
                        {items
                          .filter((item) => item.lesson_id !== draft.id)
                          .map((item) => (
                            <option key={item.lesson_id} value={item.lesson_id}>
                              {item.draft.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <h2>Activities ({draft.activities.length}/10)</h2>
                  {draft.activities.map((activity, index) => (
                    <fieldset key={activity.id} className="admin-activity">
                      <legend>Activity {index + 1}</legend>
                      <div className="admin-actions">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            change({ ...draft, activities: moveItem(draft.activities, index, -1) })
                          }
                        >
                          Move activity {index + 1} up
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.activities.length - 1}
                          onClick={() =>
                            change({ ...draft, activities: moveItem(draft.activities, index, 1) })
                          }
                        >
                          Move activity {index + 1} down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            change({
                              ...draft,
                              activities: draft.activities.filter((a) => a.id !== activity.id),
                            })
                          }
                        >
                          Delete activity {index + 1}
                        </button>
                      </div>
                      <ActivityEditor
                        activity={activity}
                        onChange={(a) =>
                          change({
                            ...draft,
                            activities: draft.activities.map((old) => (old.id === a.id ? a : old)),
                          })
                        }
                      />
                    </fieldset>
                  ))}
                  <div className="admin-actions">
                    <button
                      type="button"
                      disabled={draft.activities.length >= MAX_ACTIVITIES}
                      onClick={() =>
                        change({
                          ...draft,
                          activities: [...draft.activities, newActivity('find-word')],
                        })
                      }
                    >
                      Add activity
                    </button>
                    {draft.activities.length >= MAX_ACTIVITIES && (
                      <span role="status">Maximum 10 activities reached.</span>
                    )}
                  </div>
                  <div className="admin-actions">
                    <button className="button" type="submit">
                      {busy ? 'Saving…' : 'Save draft'}
                    </button>
                    <button className="button" type="button" onClick={() => void save(true)}>
                      Publish lesson
                    </button>
                    {current?.published && (
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() => void save(false)}
                      >
                        Unpublish lesson
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
            )}
          </>
        )}
      </main>
      <ConfirmDialog
        open={leaving !== null}
        title={leaving === 'logout' ? 'Log out?' : 'Discard unsaved changes?'}
        confirmLabel={leaving === 'logout' ? 'Log out' : 'Discard changes'}
        onCancel={() => setLeaving(null)}
        onConfirm={leave}
      >
        {dirty
          ? 'Unsaved lesson edits will be lost.'
          : 'Your saved lesson drafts will remain available.'}
      </ConfirmDialog>
    </div>
  );
}
