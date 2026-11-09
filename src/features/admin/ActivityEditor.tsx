import { useState } from 'react';
import { ChoiceRowsEditor } from './ChoiceRowsEditor';
import { ReorderableItem, reorderById } from './ReorderableItem';
import { AdminIconButton } from './AdminIconButton';
import { moveItem, newActivity, type AuthoredLesson } from './lesson-management.service';
import { ValidationFieldError, ValidationScope, ValidatedFormField, ValidatedTextareaField, useLessonValidation, type ValidationPathPart } from './lesson-validation';
type Activity = AuthoredLesson['activities'][number];

export function ActivityEditor({
  activity,
  onChange,
  validationPath = [],
}: {
  activity: Activity;
  onChange: (a: Activity) => void;
  validationPath?: ValidationPathPart[];
}) {
  const [answerFeedback, setAnswerFeedback] = useState('');
  const options = activity.type === 'organize-translate' ? activity.tokens : activity.choices;
  const acceptedTokenSequences = activity.type === 'organize-translate'
    ? activity.acceptedTokenSequences ?? [activity.correctTokenSequence]
    : [];
  const updateAcceptedSequences = (sequences: string[][], message: string) => {
    if (activity.type === 'organize-translate' && sequences.length > 0) {
      onChange({ ...activity, acceptedTokenSequences: sequences, correctTokenSequence: sequences[0] });
      setAnswerFeedback(message);
    }
  };
  const setOptions = (next: typeof options) => {
    if (activity.type !== 'organize-translate') {
      onChange({
        ...activity,
        choices: next,
        correctChoiceId: next.some((option) => option.id === activity.correctChoiceId)
          ? activity.correctChoiceId
          : next[0].id,
      });
      return;
    }
    const previous = activity.acceptedTokenSequences ?? [activity.correctTokenSequence];
    const updated = previous.map((sequence) => [
      ...sequence.filter((id) => next.some((option) => option.id === id)),
      ...next.filter((option) => !sequence.includes(option.id)).map((option) => option.id),
    ]);
    onChange({ ...activity, tokens: next, acceptedTokenSequences: updated, correctTokenSequence: updated[0] });
  };
  return (
    <ValidationScope path={validationPath}>
    <div className="admin-fields">
      <label>
        Activity type
        <select
          value={activity.type}
          onChange={(e) => {
            const nextType = e.target.value as Activity['type'];
            const next = newActivity(nextType);
            const mathStatement =
              activity.type === 'choose-correct-translation' ? undefined : activity.mathStatement;
            onChange({
              ...next,
              id: activity.id,
              title: activity.title,
              prompt: activity.prompt,
              explanation: activity.explanation,
              ...(nextType !== 'choose-correct-translation' && mathStatement !== undefined
                ? { mathStatement }
                : {}),
              ...(activity.hint ? { hint: activity.hint } : {}),
            });
          }}
        >
          <option value="find-word">Find the word</option>
          <option value="organize-translate">Organize &amp; translate</option>
          <option value="choose-correct-translation">Choose the correct translation</option>
        </select>
      </label>
      <ValidatedFormField
        label="Activity title"
        validationPath={['title']}
        value={activity.title}
        onChange={(e) => onChange({ ...activity, title: e.target.value })}
      />
      <ValidatedFormField
        label={activity.type === 'choose-correct-translation' ? 'Verbal phrase' : 'Prompt / instructions'}
        validationPath={['prompt']}
        value={activity.prompt}
        onChange={(e) => onChange({ ...activity, prompt: e.target.value })}
      />
      {activity.type !== 'choose-correct-translation' && (
        <ValidatedFormField
          label="Mathematical expression"
          validationPath={['mathStatement']}
          value={activity.mathStatement}
          onChange={(e) => onChange({ ...activity, mathStatement: e.target.value })}
        />
      )}
      {activity.type === 'find-word' && (
        <>
          <ValidatedFormField
            label="Sentence before blank"
            validationPath={['sentenceBefore']}
            value={activity.sentenceBefore}
            onChange={(e) => onChange({ ...activity, sentenceBefore: e.target.value })}
          />
          <ValidatedFormField
            label="Sentence after blank"
            validationPath={['sentenceAfter']}
            value={activity.sentenceAfter}
            onChange={(e) => onChange({ ...activity, sentenceAfter: e.target.value })}
          />
        </>
      )}
      <ChoiceRowsEditor
        choices={options}
        onChange={setOptions}
        legend={activity.type === 'organize-translate' ? 'Phrase tokens (display order)' : 'Answer choices'}
        choiceLabel={activity.type === 'organize-translate' ? 'Token' : activity.type === 'choose-correct-translation' ? 'Expression choice' : 'Choice'}
        controlLabel="option"
        addLabel={`Add ${activity.type === 'organize-translate' ? 'token' : 'choice'}`}
        maxChoices={20}
        reorderGroup={activity.type === 'organize-translate' ? `activity-${activity.id}-tokens` : undefined}
        radioGroupName={`correct-activity-${activity.id}`}
        validationPath={[activity.type === 'organize-translate' ? 'tokens' : 'choices']}
        correctChoiceId={activity.type === 'organize-translate' ? undefined : activity.correctChoiceId}
        onCorrectChoiceChange={
          activity.type === 'organize-translate'
            ? undefined
            : (choiceId) => onChange({ ...activity, correctChoiceId: choiceId })
        }
      />
      <ActivityCorrectAnswerError />
      {activity.type === 'organize-translate' && (
        <section className="admin-accepted-answers" aria-labelledby={`accepted-answers-${activity.id}`}>
          <h3 id={`accepted-answers-${activity.id}`}>Accepted answers</h3>
          <p>Add another answer only when a different token order should also be considered correct.</p>
          {acceptedTokenSequences.map((sequence, answerIndex) => (
            <fieldset className="admin-options admin-accepted-answer" key={answerIndex}>
              <legend>Accepted answer {answerIndex + 1}</legend>
              {acceptedTokenSequences.length > 1 && (
                <AdminIconButton icon="delete" label={`Remove answer ${answerIndex + 1}`}
                  onClick={() => updateAcceptedSequences(
                    acceptedTokenSequences.filter((_, index) => index !== answerIndex),
                    `Accepted answer ${answerIndex + 1} removed. Save the lesson draft to keep this change.`,
                  )}
                />
              )}
              <ol className="admin-token-order">
                {sequence.map((id, index) => (
                  <ReorderableItem as="li" key={id} group={`activity-${activity.id}-answer-${answerIndex}`}
                    id={id} label={`token ${index + 1} in accepted answer ${answerIndex + 1}`}
                    onReorder={(source, target, side) => updateAcceptedSequences(
                      acceptedTokenSequences.map((current, currentIndex) => currentIndex === answerIndex
                        ? reorderById(current, source, target, side, (tokenId) => tokenId)
                        : current),
                      `Accepted answer ${answerIndex + 1} reordered. Save the lesson draft to keep this change.`,
                    )}>
                  {(handle) => <div className="admin-token-order__item">
                    {handle}
                    <span className="admin-token-order__label">
                      {options.find((option) => option.id === id)?.label || '(empty token)'}
                    </span>
                    <span className="admin-token-order__controls">
                      <AdminIconButton icon="up" label={`Move token ${index + 1} in accepted answer ${answerIndex + 1} up`}
                        disabled={index === 0}
                        onClick={() => updateAcceptedSequences(
                          acceptedTokenSequences.map((current, currentIndex) =>
                            currentIndex === answerIndex ? moveItem(current, index, -1) : current,
                          ),
                          `Token moved up in accepted answer ${answerIndex + 1}. Save the lesson draft to keep this change.`,
                        )}
                      />
                      <AdminIconButton icon="down" label={`Move token ${index + 1} in accepted answer ${answerIndex + 1} down`}
                        disabled={index === options.length - 1}
                        onClick={() => updateAcceptedSequences(
                          acceptedTokenSequences.map((current, currentIndex) =>
                            currentIndex === answerIndex ? moveItem(current, index, 1) : current,
                          ),
                          `Token moved down in accepted answer ${answerIndex + 1}. Save the lesson draft to keep this change.`,
                        )}
                      />
                    </span>
                  </div>}
                  </ReorderableItem>
                ))}
              </ol>
            </fieldset>
          ))}
          <button
            type="button"
            className="admin-add-action"
            onClick={() => updateAcceptedSequences(
              [...acceptedTokenSequences, [...acceptedTokenSequences[0]]],
              'Accepted answer added. Choose a distinct token order, then save the lesson draft.',
            )}
          >
            + Add accepted answer
          </button>
          {answerFeedback && <p className="admin-accepted-answer__feedback" role="status">{answerFeedback}</p>}
        </section>
      )}
      <ValidatedFormField
        label="Hint (optional)"
        validationPath={['hint', 'body']}
        value={activity.hint?.body ?? ''}
        onChange={(e) =>
          onChange({ ...activity, hint: e.target.value ? { body: e.target.value } : undefined })
        }
      />
      <ValidatedFormField
        label="Feedback title (optional)"
        validationPath={['explanation', 'title']}
        value={activity.explanation?.title ?? ''}
        onChange={(e) =>
          onChange({ ...activity, explanation: { ...activity.explanation, title: e.target.value } })
        }
      />
      <ValidatedTextareaField
        label="Explanation / step-by-step solution (optional)"
        validationPath={['explanation', 'body']}
        value={activity.explanation?.body ?? ''}
        rows={4}
        onChange={(e) =>
          onChange({ ...activity, explanation: { ...activity.explanation, body: e.target.value } })
        }
      />
    </div>
    </ValidationScope>
  );
}

function ActivityCorrectAnswerError() {
  const validation = useLessonValidation(['correctChoiceId']);
  return (
    <div data-validation-path={validation.validationPath} tabIndex={-1}>
      <ValidationFieldError path={['correctChoiceId']} />
    </div>
  );
}
