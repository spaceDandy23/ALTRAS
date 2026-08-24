import { z } from 'zod';

export const explanationSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export const hintSchema = z.object({
  body: z.string().min(1),
});

export const activityChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const activityTokenSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const activityBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  hint: hintSchema.optional(),
  explanation: explanationSchema,
});

export const findWordActivitySchema = activityBaseSchema
  .extend({
    type: z.literal('find-word'),
    mathStatement: z.string().min(1),
    sentenceBefore: z.string(),
    sentenceAfter: z.string(),
    choices: z.array(activityChoiceSchema).min(2),
    correctChoiceId: z.string().min(1),
  })
  .superRefine((activity, context) => {
    const choiceIds = activity.choices.map((choice) => choice.id);
    if (new Set(choiceIds).size !== choiceIds.length) {
      context.addIssue({ code: 'custom', message: 'Choice IDs must be unique.' });
    }
    if (!choiceIds.includes(activity.correctChoiceId)) {
      context.addIssue({ code: 'custom', message: 'The correct choice must exist.' });
    }
  });

export const organizeTranslateActivitySchema = activityBaseSchema
  .extend({
    type: z.literal('organize-translate'),
    mathStatement: z.string().min(1),
    tokens: z.array(activityTokenSchema).min(2),
    correctTokenSequence: z.array(z.string().min(1)).min(2),
  })
  .superRefine((activity, context) => {
    const tokenIds = activity.tokens.map((token) => token.id);
    if (new Set(tokenIds).size !== tokenIds.length) {
      context.addIssue({ code: 'custom', message: 'Token IDs must be unique.' });
    }
    if (
      activity.correctTokenSequence.length !== tokenIds.length ||
      activity.correctTokenSequence.some((id) => !tokenIds.includes(id)) ||
      new Set(activity.correctTokenSequence).size !== tokenIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The correct sequence must use every token exactly once.',
      });
    }
  });

export const activitySchema = z.discriminatedUnion('type', [
  findWordActivitySchema,
  organizeTranslateActivitySchema,
]);

export const instructionalContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('paragraph'),
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('example'),
    phrase: z.string().min(1),
    expression: z.string().min(1),
    note: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('warning'),
    title: z.string().min(1),
    body: z.string().min(1),
  }),
]);

export const sectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  displayOrder: z.number().int().nonnegative(),
  contentVersion: z.number().int().positive(),
});

export const unitSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  displayOrder: z.number().int().nonnegative(),
  contentVersion: z.number().int().positive(),
});

export const lessonSchema = z
  .object({
    id: z.string().min(1),
    sectionId: z.string().min(1),
    unitId: z.string().min(1),
    title: z.string().min(1),
    shortDescription: z.string().min(1),
    concepts: z.array(z.string().min(1)).min(1),
    displayOrder: z.number().int().nonnegative(),
    prerequisiteLessonId: z.string().min(1).optional(),
    contentStatus: z.enum(['playable', 'preview']),
    instructionalContent: z.array(instructionalContentBlockSchema),
    activities: z.array(activitySchema),
    passingThreshold: z.number().int().min(0).max(100),
    contentVersion: z.number().int().positive(),
  })
  .superRefine((lesson, context) => {
    if (lesson.contentStatus === 'playable' && lesson.activities.length === 0) {
      context.addIssue({ code: 'custom', message: 'Playable lessons require activities.' });
    }
    const itemIds = [
      ...lesson.instructionalContent.map((block) => block.id),
      ...lesson.activities.map((activity) => activity.id),
    ];
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({ code: 'custom', message: 'Lesson content IDs must be unique.' });
    }
  });

export const packagedContentSchema = z
  .object({
    version: z.number().int().positive(),
    sections: z.array(sectionSchema).min(1),
    units: z.array(unitSchema).min(1),
    lessons: z.array(lessonSchema).min(1),
  })
  .superRefine((content, context) => {
    const sectionIds = new Set(content.sections.map((section) => section.id));
    const unitIds = new Set(content.units.map((unit) => unit.id));
    const lessonIds = new Set(content.lessons.map((lesson) => lesson.id));

    for (const unit of content.units) {
      if (!sectionIds.has(unit.sectionId)) {
        context.addIssue({ code: 'custom', message: `Unknown section: ${unit.sectionId}` });
      }
    }
    for (const lesson of content.lessons) {
      if (!sectionIds.has(lesson.sectionId) || !unitIds.has(lesson.unitId)) {
        context.addIssue({ code: 'custom', message: `Invalid lesson parent: ${lesson.id}` });
      }
      if (lesson.prerequisiteLessonId && !lessonIds.has(lesson.prerequisiteLessonId)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown prerequisite: ${lesson.prerequisiteLessonId}`,
        });
      }
    }
  });

export type ActivityChoice = z.infer<typeof activityChoiceSchema>;
export type ActivityToken = z.infer<typeof activityTokenSchema>;
export type FindWordActivity = z.infer<typeof findWordActivitySchema>;
export type OrganizeTranslateActivity = z.infer<typeof organizeTranslateActivitySchema>;
export type LessonActivity = z.infer<typeof activitySchema>;
export type InstructionalContentBlock = z.infer<typeof instructionalContentBlockSchema>;
export type LearningSection = z.infer<typeof sectionSchema>;
export type LearningUnit = z.infer<typeof unitSchema>;
export type LearningLesson = z.infer<typeof lessonSchema>;
export type PackagedContent = z.infer<typeof packagedContentSchema>;
