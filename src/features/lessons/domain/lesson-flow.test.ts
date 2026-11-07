import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import type { LearningLesson } from './content.schemas';
import {
  chapterActivityPosition,
  lessonChapters,
  nextLessonFlowState,
} from './lesson-flow';

const lesson = (): LearningLesson => {
  const base = structuredClone(packagedContent.lessons[0]);
  return {
    ...base,
    chapters: [
      {
        id: 'chapter-one',
        title: 'Chapter one',
        description: 'First chapter',
        displayOrder: 1,
        instructionalContent: [base.instructionalContent[0]],
        activities: base.activities.slice(0, 2),
      },
      {
        id: 'chapter-two',
        title: 'Chapter two',
        displayOrder: 2,
        instructionalContent: base.instructionalContent.slice(1),
        activities: base.activities.slice(2),
      },
    ],
  };
};

describe('lesson chapter runtime flow', () => {
  it('preserves chapter and activity order from published content', () => {
    const chapters = lessonChapters(lesson());
    expect(chapters.map((chapter) => chapter.id)).toEqual(['chapter-one', 'chapter-two']);
    expect(chapters[0].activities.map((activity) => activity.id)).toEqual(
      lesson().activities.slice(0, 2).map((activity) => activity.id),
    );
    expect(chapterActivityPosition(lesson(), 'chapter-two', lesson().activities[2].id)).toEqual({
      chapterIndex: 1,
      activityIndex: 0,
      flatActivityIndex: 2,
      isLastInChapter: false,
    });
  });

  it('wraps a legacy flat lesson in one predictable chapter', () => {
    const legacy = { ...lesson(), chapters: undefined };
    const [chapter] = lessonChapters(legacy);
    expect(chapter.title).toBe('Chapter 1');
    expect(chapter.instructionalContent).toEqual(legacy.instructionalContent);
    expect(chapter.activities).toEqual(legacy.activities);
  });

  it('skips teaching when a chapter has no teaching blocks', () => {
    const current = lesson();
    current.chapters![0].instructionalContent = [];
    current.chapters![1].instructionalContent = [];
    const preTest = { flowStage: 'pre-test', currentChapterId: current.chapters![0].id } as Parameters<typeof nextLessonFlowState>[1];
    expect(nextLessonFlowState(current, preTest)).toEqual({ flowStage: 'chapter-activity', currentChapterId: 'chapter-one' });
    expect(nextLessonFlowState(current, { ...preTest, flowStage: 'chapter-activity' })).toEqual({ flowStage: 'chapter-activity', currentChapterId: 'chapter-two' });
  });

  it('keeps the teaching stage for mixed teaching blocks and tables', () => {
    const current = lesson();
    current.chapters![0].instructionalContent.push({ id: 'table', type: 'content-table', tables: [] });
    expect(nextLessonFlowState(current, { flowStage: 'pre-test' } as Parameters<typeof nextLessonFlowState>[1])).toEqual({ flowStage: 'chapter-teaching', currentChapterId: 'chapter-one' });
  });
});
