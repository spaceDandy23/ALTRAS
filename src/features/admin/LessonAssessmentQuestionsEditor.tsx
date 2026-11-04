import { assessmentLabel, moveAssessmentQuestion, newAssessmentQuestion, type AdminAssessmentQuestion } from './assessment-management.service';
import type { AssessmentKind } from '@/types/assessment';

export function LessonAssessmentQuestionsEditor({
  assessment,
  questions,
  onChange,
}: {
  assessment: AssessmentKind;
  questions: AdminAssessmentQuestion[];
  onChange: (questions: AdminAssessmentQuestion[]) => void;
}) {
  const updateQuestion = (questionId: string, update: (question: AdminAssessmentQuestion) => AdminAssessmentQuestion) =>
    onChange(questions.map((question) => question.id === questionId ? update(question) : question));

  return (
    <section className="admin-lesson-assessment" aria-label={`Lesson ${assessmentLabel(assessment)}`}>
      <h3>{assessmentLabel(assessment)}</h3>
      {questions.length === 0 ? <p>No questions added yet.</p> : null}
      <ol className="admin-assessment-questions">
        {questions.map((question, questionIndex) => (
          <li key={question.id} className="admin-assessment-question panel">
            <div className="admin-section-heading">
              <h4>Question {questionIndex + 1}</h4>
              <div className="admin-question-actions">
                <button type="button" disabled={questionIndex === 0} onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, -1))}>Move up</button>
                <button type="button" disabled={questionIndex === questions.length - 1} onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, 1))}>Move down</button>
                <button type="button" onClick={() => onChange(questions.filter((item) => item.id !== question.id))}>Delete question</button>
              </div>
            </div>
            <label className="admin-assessment-prompt">
              <span>Question text</span>
              <textarea
                maxLength={2000}
                required
                value={question.prompt}
                onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, prompt: event.target.value, isPlaceholder: false }))}
              />
            </label>
            <fieldset className="admin-assessment-choices">
              <legend>Answer choices</legend>
              {question.choices.map((choice, choiceIndex) => (
                <div className="admin-assessment-choice" key={choice.id}>
                  <label className="admin-correct-choice">
                    <input type="radio" name={`correct-${question.id}`} checked={question.correctChoiceId === choice.id} onChange={() => updateQuestion(question.id, (item) => ({ ...item, correctChoiceId: choice.id }))} />
                    Correct
                  </label>
                  <label>
                    <span>Choice {choiceIndex + 1}</span>
                    <input maxLength={1000} required value={choice.label} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, choices: item.choices.map((old) => old.id === choice.id ? { ...old, label: event.target.value } : old), isPlaceholder: false }))} />
                  </label>
                  <button type="button" disabled={question.choices.length <= 2} onClick={() => updateQuestion(question.id, (item) => ({ ...item, choices: item.choices.filter((old) => old.id !== choice.id), correctChoiceId: item.correctChoiceId === choice.id ? (item.choices.find((old) => old.id !== choice.id)?.id ?? '') : item.correctChoiceId }))}>Delete choice</button>
                </div>
              ))}
              <button type="button" disabled={question.choices.length >= 10} onClick={() => updateQuestion(question.id, (item) => ({ ...item, choices: [...item.choices, { id: `choice-${crypto.randomUUID()}`, label: '' }], isPlaceholder: false }))}>Add answer choice</button>
            </fieldset>
          </li>
        ))}
      </ol>
      <button type="button" disabled={questions.length >= 100} onClick={() => onChange([...questions, newAssessmentQuestion()])}>Add {assessmentLabel(assessment)} question</button>
    </section>
  );
}
