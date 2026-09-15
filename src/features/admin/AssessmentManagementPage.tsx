import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminContentLoading } from './AdminContentLoading';
import { AssessmentContentPreview } from './AssessmentContentPreview';
import {
  assessmentLabel,
  listManagedAssessments,
  moveAssessmentQuestion,
  newAssessmentQuestion,
  publishManagedAssessment,
  saveManagedAssessment,
  type AdminAssessmentDraft,
  type ManagedAssessment,
} from './assessment-management.service';

export function AssessmentManagementPage() {
  const [items, setItems] = useState<ManagedAssessment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<ManagedAssessment | null>(null);
  const [draft, setDraft] = useState<AdminAssessmentDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    let active = true;
    void listManagedAssessments()
      .then((rows) => {
        if (!active) return;
        setItems(rows);
        setLoaded(true);
        setError('');
      })
      .catch((reason: Error) => {
        if (!active) return;
        setError(reason.message);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const current = useMemo(
    () => items.find((item) => item.assessment === selected?.assessment) ?? selected,
    [items, selected],
  );
  const accept = (item: ManagedAssessment) => {
    setItems((rows) => rows.map((row) => (row.assessment === item.assessment ? item : row)));
    setSelected(item);
    setDraft(structuredClone(item.draft));
    setDirty(false);
  };
  const change = (next: AdminAssessmentDraft) => {
    setDraft(next);
    setDirty(true);
    setNotice('');
  };
  const open = (item: ManagedAssessment) => {
    setSelected(item);
    setDraft(structuredClone(item.draft));
    setDirty(false);
    setPreview(false);
    setError('');
    setNotice('');
  };
  const close = () => {
    setSelected(null);
    setDraft(null);
    setDirty(false);
    setPreview(false);
    setDiscarding(false);
    setError('');
    setNotice('');
  };
  const save = async (publish = false) => {
    if (!current || !draft || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = dirty ? await saveManagedAssessment(current, draft) : current;
      const result = publish ? await publishManagedAssessment(saved) : saved;
      accept(result);
      setNotice(
        publish
          ? `${assessmentLabel(result.assessment)} version ${result.published_version} published.`
          : 'Draft saved.',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to manage this assessment.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <AdminContentLoading message="Loading assessments…" />;
  if (error && items.length === 0)
    return (
      <section className="admin-state panel" aria-labelledby="admin-assessments-error-title">
        <p className="researcher-kicker">Administrator workspace</p>
        <h1 id="admin-assessments-error-title">Assessments unavailable</h1>
        <p>{error}</p>
        <button
          className="button"
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

  return (
    <>
      <p className="researcher-kicker">Administrator workspace</p>
      <h1>Assessment Management</h1>
      <p>Manage immutable, server-scored Pre-test and Post-test content.</p>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!draft || !current ? (
        <div className="admin-table admin-assessment-table" tabIndex={0}>
          <table>
            <caption>Assessments</caption>
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Current version</th>
                <th>Status</th>
                <th>Questions</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.assessment}>
                  <td>{assessmentLabel(item.assessment)}</td>
                  <td>Version {item.published_version}</td>
                  <td>
                    {item.published_attempt_count > 0
                      ? `Immutable — used by ${item.published_attempt_count} attempt(s)`
                      : 'Published — unused'}
                  </td>
                  <td>{item.draft.questions.length}</td>
                  <td>
                    <button type="button" onClick={() => open(item)}>
                      Manage {assessmentLabel(item.assessment)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="admin-actions admin-assessment-toolbar">
            <button
              className="button button--quiet"
              disabled={busy}
              onClick={() => (dirty ? setDiscarding(true) : close())}
            >
              Back to assessments
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setPreview((value) => !value)}
            >
              {preview ? 'Return to editor' : 'Preview assessment'}
            </button>
            <span>
              {dirty ? 'Unsaved draft changes' : 'Saved draft'} · Published version{' '}
              {current.published_version}
            </span>
          </div>
          <p className="assessment-version-note">
            Publishing always creates a new immutable version. Existing attempts remain on their
            original version.
          </p>
          {preview ? (
            <AssessmentContentPreview draft={draft} />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset className="admin-editor" disabled={busy}>
                <legend>{assessmentLabel(draft.assessment)} draft</legend>
                <ol className="admin-assessment-questions">
                  {draft.questions.map((question, questionIndex) => (
                    <li key={question.id} className="admin-assessment-question panel">
                      <div className="admin-section-heading">
                        <h2>Question {questionIndex + 1}</h2>
                        <div className="admin-question-actions">
                          <button
                            type="button"
                            disabled={questionIndex === 0}
                            onClick={() =>
                              change({
                                ...draft,
                                questions: moveAssessmentQuestion(
                                  draft.questions,
                                  questionIndex,
                                  -1,
                                ),
                              })
                            }
                          >
                            Move up
                          </button>
                          <button
                            type="button"
                            disabled={questionIndex === draft.questions.length - 1}
                            onClick={() =>
                              change({
                                ...draft,
                                questions: moveAssessmentQuestion(
                                  draft.questions,
                                  questionIndex,
                                  1,
                                ),
                              })
                            }
                          >
                            Move down
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              change({
                                ...draft,
                                questions: draft.questions.filter(
                                  (item) => item.id !== question.id,
                                ),
                              })
                            }
                          >
                            Delete question
                          </button>
                        </div>
                      </div>
                      <label className="admin-assessment-prompt">
                        <span>Question text</span>
                        <textarea
                          maxLength={2000}
                          required
                          value={question.prompt}
                          onChange={(event) =>
                            change({
                              ...draft,
                              questions: draft.questions.map((item) =>
                                item.id === question.id
                                  ? { ...item, prompt: event.target.value, isPlaceholder: false }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <fieldset className="admin-assessment-choices">
                        <legend>Answer choices</legend>
                        {question.choices.map((choice, choiceIndex) => (
                          <div className="admin-assessment-choice" key={choice.id}>
                            <label className="admin-correct-choice">
                              <input
                                type="radio"
                                name={`correct-${question.id}`}
                                checked={question.correctChoiceId === choice.id}
                                onChange={() =>
                                  change({
                                    ...draft,
                                    questions: draft.questions.map((item) =>
                                      item.id === question.id
                                        ? { ...item, correctChoiceId: choice.id }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              Correct
                            </label>
                            <label>
                              <span>Choice {choiceIndex + 1}</span>
                              <input
                                maxLength={1000}
                                required
                                value={choice.label}
                                onChange={(event) =>
                                  change({
                                    ...draft,
                                    questions: draft.questions.map((item) =>
                                      item.id === question.id
                                        ? {
                                            ...item,
                                            choices: item.choices.map((old) =>
                                              old.id === choice.id
                                                ? { ...old, label: event.target.value }
                                                : old,
                                            ),
                                          }
                                        : item,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              disabled={question.choices.length <= 2}
                              onClick={() =>
                                change({
                                  ...draft,
                                  questions: draft.questions.map((item) =>
                                    item.id === question.id
                                      ? {
                                          ...item,
                                          choices: item.choices.filter(
                                            (old) => old.id !== choice.id,
                                          ),
                                          correctChoiceId:
                                            item.correctChoiceId === choice.id
                                              ? (item.choices.find((old) => old.id !== choice.id)
                                                  ?.id ?? '')
                                              : item.correctChoiceId,
                                        }
                                      : item,
                                  ),
                                })
                              }
                            >
                              Delete choice
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={question.choices.length >= 10}
                          onClick={() =>
                            change({
                              ...draft,
                              questions: draft.questions.map((item) =>
                                item.id === question.id
                                  ? {
                                      ...item,
                                      choices: [
                                        ...item.choices,
                                        { id: `choice-${crypto.randomUUID()}`, label: '' },
                                      ],
                                    }
                                  : item,
                              ),
                            })
                          }
                        >
                          Add answer choice
                        </button>
                      </fieldset>
                    </li>
                  ))}
                </ol>
                <div className="admin-actions">
                  <button
                    type="button"
                    onClick={() =>
                      change({ ...draft, questions: [...draft.questions, newAssessmentQuestion()] })
                    }
                  >
                    Add question
                  </button>
                </div>
                <div className="admin-actions">
                  <button className="button" type="submit">
                    {busy ? 'Saving…' : 'Save draft'}
                  </button>
                  <button className="button" type="button" onClick={() => void save(true)}>
                    Publish new version
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      <ConfirmDialog
        open={discarding}
        title="Discard unsaved assessment changes?"
        confirmLabel="Discard changes"
        onCancel={() => setDiscarding(false)}
        onConfirm={close}
      >
        Unsaved question and answer-choice edits will be lost.
      </ConfirmDialog>
    </>
  );
}
