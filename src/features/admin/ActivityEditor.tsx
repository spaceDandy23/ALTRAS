import { FormField } from '@/components/ui/FormField';
import { ChoiceRowsEditor } from './ChoiceRowsEditor';
import { moveItem, newActivity, type AuthoredLesson } from './lesson-management.service';
type Activity = AuthoredLesson['activities'][number];

export function ActivityEditor({
  activity,
  onChange,
}: {
  activity: Activity;
  onChange: (a: Activity) => void;
}) {
  const options = activity.type === 'organize-translate' ? activity.tokens : activity.choices;
  const setOptions = (next: typeof options) => {
    if (activity.type !== 'organize-translate')
      onChange({
        ...activity,
        choices: next,
        correctChoiceId: next.some((o) => o.id === activity.correctChoiceId)
          ? activity.correctChoiceId
          : next[0].id,
      });
    else
      onChange({
        ...activity,
        tokens: next,
        correctTokenSequence: [
          ...activity.correctTokenSequence.filter((id) => next.some((o) => o.id === id)),
          ...next.filter((o) => !activity.correctTokenSequence.includes(o.id)).map((o) => o.id),
        ],
      });
  };
  return (
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
          <option value="organize-translate">Organize & translate</option>
          <option value="choose-correct-translation">Choose the correct translation</option>
        </select>
      </label>
      <FormField
        label="Activity title"
        value={activity.title}
        onChange={(e) => onChange({ ...activity, title: e.target.value })}
      />
      <FormField
        label={activity.type === 'choose-correct-translation' ? 'Verbal phrase' : 'Prompt / instructions'}
        value={activity.prompt}
        onChange={(e) => onChange({ ...activity, prompt: e.target.value })}
      />
      {activity.type !== 'choose-correct-translation' && (
        <FormField
          label="Mathematical expression"
          value={activity.mathStatement}
          onChange={(e) => onChange({ ...activity, mathStatement: e.target.value })}
        />
      )}
      {activity.type === 'find-word' && (
        <>
          <FormField
            label="Sentence before blank"
            value={activity.sentenceBefore}
            onChange={(e) => onChange({ ...activity, sentenceBefore: e.target.value })}
          />
          <FormField
            label="Sentence after blank"
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
        radioGroupName={`correct-activity-${activity.id}`}
        correctChoiceId={activity.type === 'organize-translate' ? undefined : activity.correctChoiceId}
        onCorrectChoiceChange={
          activity.type === 'organize-translate'
            ? undefined
            : (choiceId) => onChange({ ...activity, correctChoiceId: choiceId })
        }
      />
      {activity.type === 'organize-translate' && (
        <fieldset className="admin-options">
          <legend>Correct token order</legend>
          <ol className="admin-token-order">
            {activity.correctTokenSequence.map((id, index) => (
              <li key={id} className="admin-token-order__item">
                <span className="admin-token-order__label">
                  {options.find((o) => o.id === id)?.label || '(empty token)'}
                </span>
                <span className="admin-token-order__controls">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move correct token ${index + 1} up`}
                    onClick={() =>
                      onChange({
                        ...activity,
                        correctTokenSequence: moveItem(activity.correctTokenSequence, index, -1),
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === options.length - 1}
                    aria-label={`Move correct token ${index + 1} down`}
                    onClick={() =>
                      onChange({
                        ...activity,
                        correctTokenSequence: moveItem(activity.correctTokenSequence, index, 1),
                      })
                    }
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </fieldset>
      )}
      <FormField
        label="Hint (optional)"
        value={activity.hint?.body ?? ''}
        onChange={(e) =>
          onChange({ ...activity, hint: e.target.value ? { body: e.target.value } : undefined })
        }
      />
      <FormField
        label="Feedback title"
        value={activity.explanation.title}
        onChange={(e) =>
          onChange({ ...activity, explanation: { ...activity.explanation, title: e.target.value } })
        }
      />
      <FormField
        label="Feedback explanation"
        value={activity.explanation.body}
        onChange={(e) =>
          onChange({ ...activity, explanation: { ...activity.explanation, body: e.target.value } })
        }
      />
    </div>
  );
}
