import {
  assessmentLabel,
  moveAssessmentQuestion,
  newAssessmentQuestion,
  type AdminAssessmentQuestion,
} from './assessment-management.service';
import type { AssessmentKind } from '@/types/assessment';
import { ChoiceRowsEditor } from './ChoiceRowsEditor';
import { ReorderableItem, reorderById } from './ReorderableItem';
import { AdminIconButton } from './AdminIconButton';
import { ChevronDown } from 'lucide-react';
import { ValidationFieldError, ValidationScope, ValidatedTextareaField } from './lesson-validation';

export function LessonAssessmentQuestionsEditor({
  assessment,
  questions,
  onChange,
  required,
  onRequiredChange,
}: {
  assessment: AssessmentKind;
  questions: AdminAssessmentQuestion[];
  onChange: (questions: AdminAssessmentQuestion[]) => void;
  required: boolean;
  onRequiredChange: (required: boolean) => void;
}) {
  const label = assessmentLabel(assessment);
  const updateQuestion = (
    questionId: string,
    update: (question: AdminAssessmentQuestion) => AdminAssessmentQuestion,
  ) => onChange(questions.map((question) => question.id === questionId ? update(question) : question));

  return (
    <ValidationScope path={['assessmentQuestions', assessment]}>
    <section className="admin-lesson-assessment" aria-label={`Lesson ${label}`}>
      <details className="admin-assessment-details">
        <summary>
          <span>{label}</span>
          <span className="admin-assessment-summary__count">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
          <span className="admin-assessment-summary__required">{required ? 'Required ✓' : 'Optional'}</span>
          <ChevronDown className="admin-summary-chevron" aria-hidden="true" />
        </summary>
        <div className="admin-assessment-content">
          <label className="admin-assessment-required">
            <input type="checkbox" checked={required} onChange={(event) => onRequiredChange(event.target.checked)} />
            Require lesson {label.toLowerCase()}
          </label>
          {required ? <>
          <div data-validation-path={JSON.stringify(['assessmentQuestions', assessment])} tabIndex={-1}>
            <ValidationFieldError path={[]} />
          </div>
          {questions.length === 0 ? <p>No questions added yet.</p> : null}
          <ol className="admin-assessment-questions">
            {questions.map((question, questionIndex) => (
              <ReorderableItem as="li" key={question.id} group={`assessment-${assessment}`} id={question.id}
                label={`${label} question ${questionIndex + 1}`}
                onReorder={(source, target, side) => onChange(reorderById(questions, source, target, side, (item) => item.id))}>
                {(handle) => (
                <ValidationScope path={[questionIndex]}>
                <details className="admin-assessment-question">
                  <summary>
                    {handle}
                    <span>Question {questionIndex + 1}</span>
                    <span className="admin-assessment-question__preview">
                      {question.prompt.trim() || 'Untitled question'}
                    </span>
                    <AdminIconButton inSummary icon="delete" label={`Delete question ${questionIndex + 1}`}
                      onClick={() => onChange(questions.filter((item) => item.id !== question.id))} />
                    <ChevronDown className="admin-summary-chevron" aria-hidden="true" />
                  </summary>
                  <div className="admin-assessment-question__content">
                    <div className="admin-question-actions">
                      <AdminIconButton icon="up" label={`Move question ${questionIndex + 1} up`}
                        disabled={questionIndex === 0}
                        onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, -1))}
                      />
                      <AdminIconButton icon="down" label={`Move question ${questionIndex + 1} down`}
                        disabled={questionIndex === questions.length - 1}
                        onClick={() => onChange(moveAssessmentQuestion(questions, questionIndex, 1))}
                      />
                    </div>
                    <ValidatedTextareaField
                      className="admin-assessment-prompt"
                      label="Question text"
                      validationPath={['prompt']}
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
                    <ChoiceRowsEditor
                      choices={question.choices}
                      legend="Answer choices"
                      choiceLabel="Choice"
                      controlLabel="choice"
                      addLabel="Add choice"
                      maxChoices={10}
                      validationPath={['choices']}
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
                    <div data-validation-path={JSON.stringify(['assessmentQuestions', assessment, questionIndex, 'correctChoiceId'])} tabIndex={-1}>
                      <ValidationFieldError path={['correctChoiceId']} />
                    </div>
                  </div>
                </details>
                </ValidationScope>
                )}
              </ReorderableItem>
            ))}
          </ol>
          <button
            type="button"
            className="admin-add-action"
            aria-label={`Add ${label} question`}
            disabled={questions.length >= 100}
            onClick={() => onChange([...questions, newAssessmentQuestion()])}
          >
            + Add {label} question
          </button>
          </> : <p>Enable the lesson {label} to manage its questions.</p>}
        </div>
      </details>
    </section>
    </ValidationScope>
  );
}
