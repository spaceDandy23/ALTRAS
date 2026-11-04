import { z } from 'zod';
import { assessmentKindSchema, type AssessmentKind } from '@/types/assessment';

export const adminAssessmentChoiceSchema = z.object({ id: z.string().min(1), label: z.string() });
export const adminAssessmentQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  choices: z.array(adminAssessmentChoiceSchema).max(10),
  correctChoiceId: z.string(),
  isPlaceholder: z.boolean().default(false),
});
export const adminAssessmentDraftSchema = z.object({
  assessment: assessmentKindSchema,
  questions: z.array(adminAssessmentQuestionSchema).max(100),
});
export const publishableAssessmentSchema = adminAssessmentDraftSchema.superRefine((draft, ctx) => {
  if (draft.questions.length === 0)
    ctx.addIssue({ code: 'custom', message: 'Add at least one question before publishing.' });
  draft.questions.forEach((question, questionIndex) => {
    if (!question.prompt.trim()) ctx.addIssue({ code: 'custom', message: `Question ${questionIndex + 1} needs text.` });
    if (question.choices.length < 2) ctx.addIssue({ code: 'custom', message: `Question ${questionIndex + 1} needs two choices.` });
    const ids = new Set<string>();
    question.choices.forEach((choice) => {
      if (!choice.label.trim()) ctx.addIssue({ code: 'custom', message: `Question ${questionIndex + 1} has an empty choice.` });
      if (ids.has(choice.id)) ctx.addIssue({ code: 'custom', message: `Question ${questionIndex + 1} has duplicate choices.` });
      ids.add(choice.id);
    });
    if (!ids.has(question.correctChoiceId)) ctx.addIssue({ code: 'custom', message: `Question ${questionIndex + 1} needs a correct answer.` });
  });
});
export type AdminAssessmentChoice = z.infer<typeof adminAssessmentChoiceSchema>;
export type AdminAssessmentQuestion = z.infer<typeof adminAssessmentQuestionSchema>;
export type AdminAssessmentDraft = z.infer<typeof adminAssessmentDraftSchema>;

export function newAssessmentQuestion(): AdminAssessmentQuestion {
  const firstChoiceId = `choice-${crypto.randomUUID()}`;
  return {
    id: `question-${crypto.randomUUID()}`, prompt: '',
    choices: [{ id: firstChoiceId, label: '' }, { id: `choice-${crypto.randomUUID()}`, label: '' }],
    correctChoiceId: firstChoiceId, isPlaceholder: false,
  };
}
export function assessmentLabel(kind: AssessmentKind): string {
  return kind === 'pre-test' ? 'Pre-test' : 'Post-test';
}
export function moveAssessmentQuestion<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}