import {
  assessmentLabel,
  moveAssessmentQuestion,
  newAssessmentQuestion,
  type AdminAssessmentQuestion,
} from './assessment-management.service';
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
  const label = assessmentLabel(assessment);
  const updateQuestion = (
    questionId: string,
    update: (question: AdminAssessmentQuestion) => AdminAssessmentQuestion,
  ) => onChange(questions.map((question) => question.id === questionId ? update(question) : question));

  return (
    <section className="admin-lesson-assessment" aria-label={`Lesson ${label}`}>
      <details className="admin-assessment-details">
        <summary>
          <span>{label}</span>
          <span className="admin-assessment-summary__count">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
        </summary>
        <div className="admin-assessment-content">
          {questions.length === 0 ? <p>No questions added yet.</p> : null}
          <ol className="admin-assessment-questions">
            {questions.map((question, questionIndex) => (
              <li key={question.id}>
                <details className="admin-assessment-question panel">
                  <summary>
                    <span>Question {questionIndex + 1}</span>
                    <span className="admin-assessment-question__preview">
                      {question.prompt.trim() || 'Untitled question'}
                    </span>
                  </summary>
                  <div className="admin-assessment-question__content">
                    <div className="admin-question-actions">
                      <button
                        type="button"
                        aria-label={`Move question ${questionIndex + 1} up`}
                        disabled={questionIndex === 0}
                        onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, -1))}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        aria-label={`Move question ${questionIndex + 1} down`}
                        disabled={questionIndex === questions.length - 1}
                        onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, 1))}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete question ${questionIndex + 1}`}
                        onClick={() => onChange(questions.filter((item) => item.id !== question.id))}
                      >
                        Delete question
                      </button>
                    </div>
                    <label className="admin-assessment-prompt">
                      <span>Question text</span>
                      <textarea
                        maxLength={2000}
                        required
                        value={question.prompt}
                        onChange={(event) =>
                          updateQuestion(question.id, (item) => ({
                            ...item,
                            prompt: event.target.value,
                            isPlaceholder: false,
                          }))
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
                                updateQuestion(question.id, (item) => ({
                                  ...item,
                                  correctChoiceId: choice.id,
                                }))
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
                                updateQuestion(question.id, (item) => ({
                                  ...item,
                                  choices: item.choices.map((old) =>
                                    old.id === choice.id
                                      ? { ...old, label: event.target.value }
                                      : old,
                                  ),
                                  isPlaceholder: false,
                                }))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            disabled={question.choices.length <= 2}
                            onClick={() =>
                              updateQuestion(question.id, (item) => ({
                                ...item,
                                choices: item.choices.filter((old) => old.id !== choice.id),
                                correctChoiceId:
                                  item.correctChoiceId === choice.id
                                    ? (item.choices.find((old) => old.id !== choice.id)?.id ?? '')
                                    : item.correctChoiceId,
                              }))
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
                          updateQuestion(question.id, (item) => ({
                            ...item,
                            choices: [
                              ...item.choices,
                              { id: `choice-${crypto.randomUUID()}`, label: '' },
                            ],
                            isPlaceholder: false,
                          }))
                        }
                      >
                        Add answer choice
                      </button>
                    </fieldset>
                  </div>
                </details>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={questions.length >= 100}
            onClick={() => onChange([...questions, newAssessmentQuestion()])}
          >
            Add {label} question
          </button>
        </div>
      </details>
    </section>
  );
}
