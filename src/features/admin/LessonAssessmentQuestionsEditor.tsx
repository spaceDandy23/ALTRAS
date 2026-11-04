import {
  assessmentLabel,
  moveAssessmentQuestion,
  newAssessmentQuestion,
  type AdminAssessmentQuestion,
} from './assessment-management.service';
import type { AssessmentKind } from '@/types/assessment';
import { ChoiceRowsEditor } from './ChoiceRowsEditor';

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
                    <ChoiceRowsEditor
                      choices={question.choices}
                      legend="Answer choices"
                      choiceLabel="Choice"
                      controlLabel="choice"
                      addLabel="Add choice"
                      maxChoices={10}
                      choiceMaxLength={1000}
                      choiceRequired
                      choiceIdPrefix="choice-"
                      radioGroupName={`correct-${question.id}`}
                      correctChoiceId={question.correctChoiceId}
                      onCorrectChoiceChange={(choiceId) =>
                        updateQuestion(question.id, (item) => ({
                          ...item,
                          correctChoiceId: choiceId,
                        }))
                      }
                      onChange={(choices) =>
                        updateQuestion(question.id, (item) => ({
                          ...item,
                          choices,
                          correctChoiceId: choices.some((choice) => choice.id === item.correctChoiceId)
                            ? item.correctChoiceId
                            : (choices[0]?.id ?? ''),
                          isPlaceholder: false,
                        }))
                      }
                    />
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
