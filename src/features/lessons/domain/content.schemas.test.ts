import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import { packagedContentSchema } from './content.schemas';

describe('learning content schema', () => {
  it('accepts the bundled unit and both supported activity types', () => {
    const parsed = packagedContentSchema.parse(packagedContent);
    const playable = parsed.lessons.find((lesson) => lesson.contentStatus === 'playable');

    expect(playable?.activities).toHaveLength(6);
    expect(playable?.activities.filter((activity) => activity.type === 'find-word')).toHaveLength(
      3,
    );
    expect(
      playable?.activities.filter((activity) => activity.type === 'organize-translate'),
    ).toHaveLength(3);
  });

  it('rejects invalid relationships and incorrect activity answers', () => {
    const invalid = structuredClone(packagedContent);
    invalid.lessons[0].unitId = 'missing-unit';
    const activity = invalid.lessons[0].activities[0];
    if (activity.type === 'find-word') activity.correctChoiceId = 'not-a-choice';

    expect(packagedContentSchema.safeParse(invalid).success).toBe(false);
  });
});
