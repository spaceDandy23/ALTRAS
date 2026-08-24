import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { FindWordActivity } from '../domain/content.schemas';
import type { SubmittedActivityAnswer } from '@/types/learning';

export function FindWordActivityView({
  activity,
  submitted,
  onSubmit,
}: {
  activity: FindWordActivity;
  submitted?: SubmittedActivityAnswer;
  onSubmit: (answer: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const visibleAnswer = submitted?.answer ?? selected;
  const visibleLabel =
    typeof visibleAnswer === 'string'
      ? activity.choices.find((choice) => choice.id === visibleAnswer)?.label
      : undefined;

  const submit = async () => {
    if (!selected || submitted) return;
    setSaving(true);
    try {
      await onSubmit(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="activity-card activity-card--find-word">
      <div className="activity-heading">
        <span className="activity-kind">Find the word</span>
        <h1>{activity.title}</h1>
        <p>{activity.prompt}</p>
      </div>
      <div
        className="math-statement"
        aria-label={`Mathematical expression: ${activity.mathStatement}`}
      >
        {activity.mathStatement}
      </div>
      <fieldset className="find-word-fieldset" disabled={Boolean(submitted)}>
        <legend>
          <span>{activity.sentenceBefore}</span>
          <span className="sentence-blank">{visibleLabel ?? 'choose a word'}</span>
          <span>{activity.sentenceAfter}</span>
        </legend>
        <div className="choice-grid">
          {activity.choices.map((choice) => {
            const selectedChoice = visibleAnswer === choice.id;
            const submittedState = submitted
              ? selectedChoice
                ? submitted.isCorrect
                  ? 'choice-option--correct'
                  : 'choice-option--incorrect'
                : choice.id === activity.correctChoiceId
                  ? 'choice-option--answer'
                  : ''
              : '';
            return (
              <label
                key={choice.id}
                className={`choice-option ${selected === choice.id ? 'choice-option--selected' : ''} ${submittedState}`}
              >
                <input
                  type="radio"
                  name={activity.id}
                  value={choice.id}
                  checked={visibleAnswer === choice.id}
                  onChange={() => setSelected(choice.id)}
                />
                <span>{choice.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {!submitted && (
        <div className="activity-actions">
          {activity.hint && (
            <Button variant="quiet" onClick={() => setHintVisible((visible) => !visible)}>
              {hintVisible ? 'Hide hint' : 'Show hint'}
            </Button>
          )}
          <Button disabled={!selected || saving} onClick={() => void submit()}>
            {saving ? 'Checking…' : 'Submit answer'}
          </Button>
        </div>
      )}
      {hintVisible && !submitted && (
        <p className="activity-hint" role="status">
          <strong>Hint:</strong> {activity.hint?.body}
        </p>
      )}
    </div>
  );
}
