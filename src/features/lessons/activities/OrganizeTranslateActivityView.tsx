import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { OrganizeTranslateActivity } from '../domain/content.schemas';
import type { SubmittedActivityAnswer } from '@/types/learning';

export function OrganizeTranslateActivityView({
  activity,
  submitted,
  onSubmit,
}: {
  activity: OrganizeTranslateActivity;
  submitted?: SubmittedActivityAnswer;
  onSubmit: (answer: string[]) => Promise<void>;
}) {
  const submittedSequence = Array.isArray(submitted?.answer) ? submitted.answer : null;
  const [sequence, setSequence] = useState<string[]>(submittedSequence ?? []);
  const [hintVisible, setHintVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const tokenById = new Map(activity.tokens.map((token) => [token.id, token]));
  const available = activity.tokens.filter((token) => !sequence.includes(token.id));
  const submit = async () => {
    if (sequence.length !== activity.tokens.length || submitted) return;
    setSaving(true);
    try {
      await onSubmit(sequence);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="activity-card activity-card--organize">
      <div className="activity-heading">
        <span className="activity-kind">Organize &amp; translate</span>
        <h1>{activity.title}</h1>
        <p>{activity.prompt}</p>
      </div>
      <div
        className="math-statement"
        aria-label={`Mathematical expression: ${activity.mathStatement}`}
      >
        {activity.mathStatement}
      </div>
      <section className="translation-builder" aria-label="Your arranged translation">
        <span className="translation-builder__label">Your translation</span>
        <div className="selected-token-list" aria-live="polite">
          {sequence.length === 0 && (
            <span className="translation-placeholder">Select the first phrase below</span>
          )}
          {sequence.map((tokenId, index) => (
            <button
              key={tokenId}
              className="selected-token"
              disabled={Boolean(submitted)}
              onClick={() =>
                setSequence((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
              aria-label={`Remove ${tokenById.get(tokenId)?.label}`}
            >
              {tokenById.get(tokenId)?.label} {!submitted && <span aria-hidden="true">×</span>}
            </button>
          ))}
        </div>
      </section>
      {!submitted && (
        <>
          <div className="available-token-list" aria-label="Available phrase tokens">
            {available.map((token) => (
              <button
                key={token.id}
                className="available-token"
                onClick={() => setSequence((current) => [...current, token.id])}
              >
                <span aria-hidden="true">+</span> {token.label}
              </button>
            ))}
          </div>
          <div className="builder-tools">
            <button
              disabled={sequence.length === 0}
              onClick={() => setSequence((current) => current.slice(0, -1))}
            >
              ↶ Undo last
            </button>
            <button disabled={sequence.length === 0} onClick={() => setSequence([])}>
              Reset all
            </button>
          </div>
          <div className="activity-actions">
            {activity.hint && (
              <Button variant="quiet" onClick={() => setHintVisible((visible) => !visible)}>
                {hintVisible ? 'Hide hint' : 'Show hint'}
              </Button>
            )}
            <Button
              disabled={sequence.length !== activity.tokens.length || saving}
              onClick={() => void submit()}
            >
              {saving ? 'Checking…' : 'Submit translation'}
            </Button>
          </div>
        </>
      )}
      {hintVisible && !submitted && <p className="activity-hint">Hint: {activity.hint?.body}</p>}
    </div>
  );
}
