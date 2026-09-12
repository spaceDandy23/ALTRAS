import { FormField } from '@/components/ui/FormField';
import { moveItem, newActivity, type AuthoredLesson } from './lesson-management.service';
type Activity = AuthoredLesson['activities'][number];

export function ActivityEditor({
  activity,
  onChange,
}: {
  activity: Activity;
  onChange: (a: Activity) => void;
}) {
  const options = activity.type === 'find-word' ? activity.choices : activity.tokens;
  const setOptions = (next: typeof options) => {
    if (activity.type === 'find-word')
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
          onChange={(e) =>
            onChange({
              ...newActivity(e.target.value as Activity['type']),
              id: activity.id,
              title: activity.title,
              prompt: activity.prompt,
              mathStatement: activity.mathStatement,
              explanation: activity.explanation,
            })
          }
        >
          <option value="find-word">Find the word</option>
          <option value="organize-translate">Organize & translate</option>
        </select>
      </label>
      <FormField
        label="Activity title"
        value={activity.title}
        onChange={(e) => onChange({ ...activity, title: e.target.value })}
      />
      <FormField
        label="Prompt / instructions"
        value={activity.prompt}
        onChange={(e) => onChange({ ...activity, prompt: e.target.value })}
      />
      <FormField
        label="Mathematical expression"
        value={activity.mathStatement}
        onChange={(e) => onChange({ ...activity, mathStatement: e.target.value })}
      />
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
      <fieldset className="admin-options">
        <legend>
          {activity.type === 'find-word' ? 'Answer choices' : 'Phrase tokens (display order)'}
        </legend>
        {options.map((option, index) => (
          <div key={option.id} className="admin-option">
            <FormField
              label={`${activity.type === 'find-word' ? 'Choice' : 'Token'} ${index + 1}`}
              value={option.label}
              onChange={(e) =>
                setOptions(
                  options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)),
                )
              }
            />
            <button
              type="button"
              disabled={index === 0}
              aria-label={`Move option ${index + 1} up`}
              onClick={() => setOptions(moveItem(options, index, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === options.length - 1}
              aria-label={`Move option ${index + 1} down`}
              onClick={() => setOptions(moveItem(options, index, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              disabled={options.length <= 2}
              aria-label={`Remove option ${index + 1}`}
              onClick={() => setOptions(options.filter((o) => o.id !== option.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={options.length >= 20}
          onClick={() => setOptions([...options, { id: crypto.randomUUID(), label: '' }])}
        >
          Add {activity.type === 'find-word' ? 'choice' : 'token'}
        </button>
      </fieldset>
      {activity.type === 'find-word' ? (
        <label>
          Correct answer
          <select
            value={activity.correctChoiceId}
            onChange={(e) => onChange({ ...activity, correctChoiceId: e.target.value })}
          >
            {options.map((option, index) => (
              <option key={option.id} value={option.id}>
                {option.label || `Choice ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <fieldset className="admin-options">
          <legend>Correct token order</legend>
          <ol>
            {activity.correctTokenSequence.map((id, index) => (
              <li key={id}>
                {options.find((o) => o.id === id)?.label || '(empty token)'}
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
