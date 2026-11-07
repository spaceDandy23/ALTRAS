import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FormField } from '@/components/ui/FormField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminContentLoading } from './AdminContentLoading';
import { ActivityEditor } from './ActivityEditor';
import { InstructionalContentEditor } from './InstructionalContentEditor';
import { LessonAssessmentQuestionsEditor } from './LessonAssessmentQuestionsEditor';
import { LessonContentPreview } from './LessonContentPreview';
import { ContentTablesEditor } from './ContentTablesEditor';
import { vocabularyTables as getVocabularyTables } from '@/features/lessons/domain/content-tables';
import { ReorderableItem, reorderById } from './ReorderableItem';
import { AdminIconButton } from './AdminIconButton';
import {
  listManagedLessons,
  saveManagedLesson,
  publishManagedLesson,
  newLesson,
  newActivity,
  newChapter,
  newInstructionalBlock,
  normalizeAuthoredLesson,
  moveItem,
  totalLessonActivities,
  MAX_ACTIVITIES,
  MAX_LESSONS,
  type AuthoredLesson,
  type ManagedLesson,
} from './lesson-management.service';
import type { ContentTable, InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';
import './lesson-management.css';

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

export function LessonManagementPage() {
  const [items, setItems] = useState<ManagedLesson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<AuthoredLesson | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
  const saveFeedbackRef = useRef<HTMLDivElement>(null);
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
      .catch((e: unknown) => {
        if (active) {
          setError(errorMessage(e, 'Unable to load lessons.'));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!error || !draft || preview) return;
    saveFeedbackRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'center' });
    saveFeedbackRef.current?.focus({ preventScroll: true });
  }, [error, draft, preview]);
  const current = items.find((item) => item.lesson_id === draft?.id);
  const vocabularyTables = draft?.chapters.flatMap((chapter) =>
    chapter.instructionalContent.flatMap((block) =>
      block.type === 'vocabulary-table' ? [{ chapterId: chapter.id, block }] : [],
    ),
  ) ?? [];
  const referenceTables = vocabularyTables.flatMap(({ block }) => getVocabularyTables(block));
  const change = (next: AuthoredLesson) => {
    setDraft(normalizeAuthoredLesson(next));
    setDirty(true);
    setError('');
    setNotice('');
  };
  const changeChapters = (chapters: AuthoredLesson['chapters']) => {
    if (draft) {
      change({
        ...draft,
        chapters: chapters.map((chapter, index) => ({ ...chapter, displayOrder: index + 1 })),
      });
    }
  };
  const updateVocabularyTables = (tables: ContentTable[]) => {
    if (!draft) return;
    const first = vocabularyTables[0];
    // References are edited together; consolidate only this draft, keeping table/row IDs.
    changeChapters(
      draft.chapters.map((chapter, index) => ({
        ...chapter,
        instructionalContent: first
          ? chapter.instructionalContent.flatMap<InstructionalContentBlock>((block) => block.type !== 'vocabulary-table' ? [block]
            : chapter.id === first.chapterId && block.id === first.block.id
              ? [{ ...block, rows: [], tables }] : [])
          : index === 0 ? [...chapter.instructionalContent, {
              id: `content-${crypto.randomUUID()}`, type: 'vocabulary-table' as const,
              title: 'Vocabulary', rows: [], tables,
            }] : chapter.instructionalContent,
      })),
    );
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
      setError(errorMessage(e, 'Unable to save or publish lesson.'));
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    setDraft(null);
    setPreview(false);
    setDirty(false);
    setError('');
    setNotice('');
    setLeaving(false);
  };

  if (!loaded) return <AdminContentLoading message="Loading lessons…" />;

  if (error && items.length === 0 && !draft) {
    return (
      <section className="admin-state panel" aria-labelledby="admin-lessons-error-title">
        <p className="researcher-kicker">Administrator workspace</p>
        <h1 id="admin-lessons-error-title">Lessons unavailable</h1>
        <p>{error}</p>
        <button
          className="button"
          type="button"
          onClick={() => {
            setLoaded(false);
            setError('');
            setReload((value) => value + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <>
      <p className="researcher-kicker">Administrator workspace</p>
      <h1 className="admin-lesson-management-title">Basic Lesson Management</h1>
      <p>
        Create and publish lessons in Operation Words. Maximum {MAX_LESSONS} lessons and 10
        activities per lesson.
      </p>
      {error && !draft && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {notice && !draft && <p role="status">{notice}</p>}
      {!draft ? (
        <>
          <div className="admin-actions">
            <div className="lesson-actions">
              <button
                className="button"
                disabled={items.length >= MAX_LESSONS}
                onClick={() => {
                  setDraft(newLesson(Math.max(0, ...items.map((i) => i.draft.displayOrder)) + 1));
                  setRevision(0);
                  setDirty(true);
                  setNotice('');
                }}
              >
                Create lesson
              </button>
              {items.length >= MAX_LESSONS && (
                <span role="status">Maximum {MAX_LESSONS} lessons reached.</span>
              )}
              <button className="button button--quiet" onClick={() => setReload(reload + 1)}>
                Refresh list
              </button>
            </div>
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
                    <td>{totalLessonActivities(item.draft)}/10</td>
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
            <div className="lesson-actions">
              <button
                className="button button--quiet"
                disabled={busy}
                onClick={() => (dirty ? setLeaving(true) : (setDraft(null), setPreview(false)))}
              >
                Back to lessons
              </button>
              <button className="button button--quiet" onClick={() => setPreview(!preview)}>
                {preview ? 'Return to editor' : 'Preview lesson'}
              </button>
            </div>
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
                <legend>Lesson details</legend>
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
                    onChange={(e) => change({ ...draft, passingThreshold: Number(e.target.value) })}
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
                <details className="admin-vocabulary-details" open={vocabularyOpen}
                  onToggle={(event) => setVocabularyOpen(event.currentTarget.open)}>
                  <summary>
                    Vocabulary ({referenceTables.length ? `${referenceTables.length} tables` : 'not added'})
                  </summary>
                  <div className="admin-vocabulary-content">
                    {vocabularyOpen && <ContentTablesEditor tables={referenceTables} onChange={updateVocabularyTables} />}
                  </div>
                </details>
                <h2>Assessments</h2>
                  <LessonAssessmentQuestionsEditor
                    assessment="pre-test"
                    required={draft.assessments?.preTest === 'pre-test'}
                    onRequiredChange={(required) => change({ ...draft, assessments: {
                      ...draft.assessments, preTest: required ? 'pre-test' : undefined,
                    } })}
                    questions={draft.assessmentQuestions['pre-test']}
                    onChange={(questions) =>
                      change({
                        ...draft,
                        assessmentQuestions: { ...draft.assessmentQuestions, 'pre-test': questions },
                      })
                    }
                  />
                  <LessonAssessmentQuestionsEditor
                    assessment="post-test"
                    required={draft.assessments?.postTest === 'post-test'}
                    onRequiredChange={(required) => change({ ...draft, assessments: {
                      ...draft.assessments, postTest: required ? 'post-test' : undefined,
                    } })}
                    questions={draft.assessmentQuestions['post-test']}
                    onChange={(questions) =>
                      change({
                        ...draft,
                        assessmentQuestions: { ...draft.assessmentQuestions, 'post-test': questions },
                      })
                    }
                  />
                <div className="admin-section-heading">
                  <div>
                    <h2>Chapters ({draft.chapters.length})</h2>
                    <p>{totalLessonActivities(draft)}/10 activities across this lesson.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      changeChapters([...draft.chapters, newChapter(draft.chapters.length + 1)])
                    }
                  >
                    Add chapter
                  </button>
                </div>
                {draft.chapters.map((chapter, chapterIndex) => (
                  <ReorderableItem key={chapter.id} group={`lesson-${draft.id}-chapters`} id={chapter.id}
                    label={`chapter ${chapterIndex + 1}`}
                    onReorder={(source, target, side) => changeChapters(reorderById(draft.chapters, source, target, side, (item) => item.id))}>
                  {(chapterHandle) => <div className="admin-chapter">
                    <details className="admin-chapter-details">
                      <summary>
                        {chapterHandle}
                        <span className="admin-summary-title">Chapter {chapterIndex + 1}: {chapter.title || 'Untitled chapter'}</span>
                        <span className="admin-summary-meta">{chapter.instructionalContent.length} teaching · {chapter.activities.length} {chapter.activities.length === 1 ? 'activity' : 'activities'}</span>
                        <AdminIconButton inSummary icon="delete" label={`Delete chapter ${chapterIndex + 1}`} onClick={() => setDeletingChapterId(chapter.id)} />
                        <ChevronDown className="admin-summary-chevron" aria-hidden="true" />
                      </summary>
                      <div className="admin-chapter-content">
                    <div className="admin-actions lesson-actions">
                      <AdminIconButton icon="up" label={`Move chapter ${chapterIndex + 1} up`}
                        disabled={chapterIndex === 0}
                        onClick={() => changeChapters(moveItem(draft.chapters, chapterIndex, -1))}
                      />
                      <AdminIconButton icon="down" label={`Move chapter ${chapterIndex + 1} down`}
                        disabled={chapterIndex === draft.chapters.length - 1}
                        onClick={() => changeChapters(moveItem(draft.chapters, chapterIndex, 1))}
                      />
                    </div>
                    <div className="admin-fields">
                      <FormField
                        label="Chapter title"
                        required
                        value={chapter.title}
                        onChange={(event) =>
                          changeChapters(
                            draft.chapters.map((item) =>
                              item.id === chapter.id
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <FormField
                        label="Chapter description"
                        value={chapter.description ?? ''}
                        onChange={(event) =>
                          changeChapters(
                            draft.chapters.map((item) =>
                              item.id === chapter.id
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <h3>Teaching and discussion content</h3>
                    {chapter.instructionalContent.map((block, contentIndex) => (
                      <ReorderableItem key={block.id} group={`chapter-${chapter.id}-content`} id={block.id}
                        label={`teaching content ${contentIndex + 1}`}
                        onReorder={(source, target, side) => changeChapters(draft.chapters.map((item) =>
                          item.id === chapter.id ? { ...item, instructionalContent: reorderById(item.instructionalContent, source, target, side, (entry) => entry.id) } : item,
                        ))}>
                      {(contentHandle) => <details className="admin-instruction">
                        <summary>
                          {contentHandle}
                          <span className="admin-summary-title">Content {contentIndex + 1} · {block.type === 'vocabulary-table' ? 'Vocabulary reference' : block.type === 'example' ? 'Example' : block.type === 'warning' ? 'Important note' : 'Explanation'} ·{' '}
                          {block.type === 'example' ? block.phrase : block.title || 'Untitled content'}</span>
                          {block.type !== 'vocabulary-table' && <AdminIconButton inSummary icon="delete" label={`Delete content ${contentIndex + 1}`}
                            onClick={() => changeChapters(draft.chapters.map((item) => item.id === chapter.id
                              ? { ...item, instructionalContent: item.instructionalContent.filter((entry) => entry.id !== block.id) } : item))} />}
                          <ChevronDown className="admin-summary-chevron" aria-hidden="true" />
                        </summary>
                        <div className="admin-instruction-content">
                        <div className="admin-actions lesson-actions">
                          <AdminIconButton icon="up" label={`Move content ${contentIndex + 1} up`}
                            disabled={contentIndex === 0}
                            onClick={() =>
                              changeChapters(
                                draft.chapters.map((item) =>
                                  item.id === chapter.id
                                    ? {
                                        ...item,
                                        instructionalContent: moveItem(
                                          item.instructionalContent,
                                          contentIndex,
                                          -1,
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          <AdminIconButton icon="down" label={`Move content ${contentIndex + 1} down`}
                            disabled={contentIndex === chapter.instructionalContent.length - 1}
                            onClick={() =>
                              changeChapters(
                                draft.chapters.map((item) =>
                                  item.id === chapter.id
                                    ? {
                                        ...item,
                                        instructionalContent: moveItem(
                                          item.instructionalContent,
                                          contentIndex,
                                          1,
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                        {block.type === 'vocabulary-table' ? <p>Edit this reference in the Vocabulary section above.</p> : <InstructionalContentEditor
                          block={block}
                          onChange={(next) =>
                            changeChapters(
                              draft.chapters.map((item) =>
                                item.id === chapter.id
                                  ? {
                                      ...item,
                                      instructionalContent: item.instructionalContent.map(
                                        (entry) => (entry.id === block.id ? next : entry),
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />}
                        </div>
                      </details>}
                      </ReorderableItem>
                    ))}
                    <button
                      type="button"
                      className="admin-add-action"
                      aria-label={`Add teaching content to ${chapter.title}`}
                      onClick={() =>
                        changeChapters(
                          draft.chapters.map((item) =>
                            item.id === chapter.id
                              ? {
                                  ...item,
                                  instructionalContent: [
                                    ...item.instructionalContent,
                                    newInstructionalBlock(),
                                  ],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      + Add teaching content
                    </button>
                    <h3>Activities ({chapter.activities.length})</h3>
                    {chapter.activities.map((activity, activityIndex) => (
                      <ReorderableItem key={activity.id} group={`chapter-${chapter.id}-activities`} id={activity.id}
                        label={`activity ${activityIndex + 1}`}
                        onReorder={(source, target, side) => changeChapters(draft.chapters.map((item) =>
                          item.id === chapter.id ? { ...item, activities: reorderById(item.activities, source, target, side, (entry) => entry.id) } : item,
                        ))}>
                      {(activityHandle) => <details className="admin-activity">
                        <summary>
                          {activityHandle}
                          <span className="admin-summary-title">Activity {activityIndex + 1} ·{' '}
                          {activity.type === 'find-word'
                            ? 'Find the word'
                            : activity.type === 'organize-translate'
                              ? 'Organize & translate'
                              : 'Choose the correct translation'} ·{' '}
                          <span className="admin-activity-summary__preview">
                            {activity.title || activity.prompt || 'Untitled activity'}
                          </span></span>
                          <AdminIconButton inSummary icon="delete" label={`Delete activity ${activityIndex + 1}`}
                            onClick={() => changeChapters(draft.chapters.map((item) => item.id === chapter.id
                              ? { ...item, activities: item.activities.filter((entry) => entry.id !== activity.id) } : item))} />
                          <ChevronDown className="admin-summary-chevron" aria-hidden="true" />
                        </summary>
                        <div className="admin-activity-content">
                        <div className="admin-actions lesson-actions">
                          <AdminIconButton icon="up" label={`Move activity ${activityIndex + 1} up`}
                            disabled={activityIndex === 0}
                            onClick={() =>
                              changeChapters(
                                draft.chapters.map((item) =>
                                  item.id === chapter.id
                                    ? {
                                        ...item,
                                        activities: moveItem(item.activities, activityIndex, -1),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          <AdminIconButton icon="down" label={`Move activity ${activityIndex + 1} down`}
                            disabled={activityIndex === chapter.activities.length - 1}
                            onClick={() =>
                              changeChapters(
                                draft.chapters.map((item) =>
                                  item.id === chapter.id
                                    ? {
                                        ...item,
                                        activities: moveItem(item.activities, activityIndex, 1),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          {draft.chapters.length > 1 && (
                            <label>
                              Activity chapter
                              <select
                                value={chapter.id}
                                onChange={(event) => {
                                  const destination = event.target.value;
                                  changeChapters(
                                    draft.chapters.map((item) =>
                                      item.id === chapter.id
                                        ? {
                                            ...item,
                                            activities: item.activities.filter(
                                              (entry) => entry.id !== activity.id,
                                            ),
                                          }
                                        : item.id === destination
                                          ? { ...item, activities: [...item.activities, activity] }
                                          : item,
                                    ),
                                  );
                                }}
                              >
                                {draft.chapters.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                        <ActivityEditor
                          activity={activity}
                          onChange={(next) =>
                            changeChapters(
                              draft.chapters.map((item) =>
                                item.id === chapter.id
                                  ? {
                                      ...item,
                                      activities: item.activities.map((entry) =>
                                        entry.id === activity.id ? next : entry,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        </div>
                      </details>}
                      </ReorderableItem>
                    ))}
                    <button
                      type="button"
                      className="admin-add-action"
                      aria-label={`Add activity to ${chapter.title}`}
                      disabled={totalLessonActivities(draft) >= MAX_ACTIVITIES}
                      onClick={() =>
                        changeChapters(
                          draft.chapters.map((item) =>
                            item.id === chapter.id
                              ? {
                                  ...item,
                                  activities: [...item.activities, newActivity('find-word')],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      + Add activity
                    </button>
                      </div>
                    </details>
                  </div>}
                  </ReorderableItem>
                ))}
                <div className="admin-actions">
                  {totalLessonActivities(draft) >= MAX_ACTIVITIES && (
                    <span role="status">Maximum 10 activities reached.</span>
                  )}
                </div>
                <div className="admin-actions">
                  {(error || notice) && (
                    <div
                      ref={saveFeedbackRef}
                      className="admin-save-feedback"
                      tabIndex={error ? -1 : undefined}
                    >
                      {error && <p className="form-alert" role="alert">{error}</p>}
                      {notice && <p role="status">{notice}</p>}
                    </div>
                  )}
                  <div className="lesson-actions">
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
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      <ConfirmDialog
        open={leaving}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        onCancel={() => setLeaving(false)}
        onConfirm={leave}
      >
        Unsaved lesson edits will be lost.
      </ConfirmDialog>
      <ConfirmDialog
        open={deletingChapterId !== null}
        title="Delete chapter?"
        confirmLabel="Delete chapter"
        onCancel={() => setDeletingChapterId(null)}
        onConfirm={() => {
          if (draft && deletingChapterId) {
            changeChapters(draft.chapters.filter((chapter) => chapter.id !== deletingChapterId));
          }
          setDeletingChapterId(null);
        }}
      >
        This removes the chapter and its teaching content and activities from the draft. Save the
        draft to keep this change; published content remains unchanged until republished.
      </ConfirmDialog>
    </>
  );
}
