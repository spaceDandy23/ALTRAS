import { describe, expect, it } from 'vitest';
import {
  adminAssessmentQuestionSchema,
  moveAssessmentQuestion,
  newAssessmentQuestion,
  publishableAssessmentSchema,
} from './assessment-management.service';

describe('lesson assessment question authoring helpers', () => {
  it('creates a valid editable question with two distinct choices and a selected key', () => {
    const question = newAssessmentQuestion();
    expect(adminAssessmentQuestionSchema.parse(question)).toEqual(question);
    expect(question.choices).toHaveLength(2);
    expect(question.choices.some((choice) => choice.id === question.correctChoiceId)).toBe(true);
  });
  it('reorders questions without changing their content', () => {
    expect(moveAssessmentQuestion(['first', 'second', 'third'], 1, 1)).toEqual(['first', 'third', 'second']);
    expect(moveAssessmentQuestion(['first'], 0, -1)).toEqual(['first']);
  });
  it('requires nonempty publishable lesson assessment content', () => {
    expect(() => publishableAssessmentSchema.parse({ assessment: 'pre-test', questions: [] })).toThrow('at least one question');
  });
});