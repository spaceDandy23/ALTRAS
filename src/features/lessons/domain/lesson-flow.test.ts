import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import type { LearningLesson } from './content.schemas';
import {
  chapterActivityPosition,
  lessonChapters,
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
});
