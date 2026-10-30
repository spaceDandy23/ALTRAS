import { useState } from 'react';
import type { AdminAssessmentDraft } from './assessment-management.service';
import { assessmentLabel, publishableAssessmentSchema } from './assessment-management.service';

export function AssessmentContentPreview({ draft }: { draft: AdminAssessmentDraft }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const result = publishableAssessmentSchema.safeParse(draft);
  if (!result.success)
    return (
      <p role="alert">
        Complete assessment configuration before previewing: {result.error.issues[0]?.message}
      </p>
    );
  return (
    <section className="admin-preview" aria-label={`${assessmentLabel(draft.assessment)} preview`}>
      <h2>{assessmentLabel(draft.assessment)} preview</h2>
      <p>Preview only — no attempt, answer, score, or research record is created.</p>
      {draft.questions.map((question, index) => (
        <fieldset className="admin-assessment-preview-question" key={question.id}>
          <legend>Question {index + 1}</legend>
          <p>{question.prompt}</p>
          {question.choices.map((choice) => (
            <label key={choice.id}>
              <input
                type="radio"
                name={`preview-${question.id}`}
                value={choice.id}
                checked={answers[question.id] === choice.id}
                onChange={() => setAnswers((current) => ({ ...current, [question.id]: choice.id }))}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  );
}
