import type { AltrasDatabase } from '@/db/database';
import {
  lessonSchema,
  packagedContentSchema,
  type LearningLesson,
  type PackagedContent,
} from '../domain/content.schemas';
import {
  contentVersionRecordSchema,
  storedLessonItemSchema,
  storedLessonSchema,
  type StoredLessonItem,
} from '@/types/learning';
import { packagedContent } from './packaged-content';

export class ContentInitializationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContentInitializationError';
  }
}

export async function initializePackagedContent(
  database: AltrasDatabase,
  input: unknown = packagedContent,
): Promise<PackagedContent> {
  const parsed = packagedContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentInitializationError('The bundled lesson content is invalid.', {
      cause: parsed.error,
    });
  }

  const validated = parsed.data;
  const lessons = validated.lessons.map((lesson) =>
    storedLessonSchema.parse({
      id: lesson.id,
      sectionId: lesson.sectionId,
      unitId: lesson.unitId,
      title: lesson.title,
      shortDescription: lesson.shortDescription,
      concepts: lesson.concepts,
      displayOrder: lesson.displayOrder,
      prerequisiteLessonId: lesson.prerequisiteLessonId,
      contentStatus: lesson.contentStatus,
      passingThreshold: lesson.passingThreshold,
      contentVersion: lesson.contentVersion,
    }),
  );
  const items: StoredLessonItem[] = validated.lessons.flatMap((lesson) => [
    ...lesson.instructionalContent.map((block, index) =>
      storedLessonItemSchema.parse({
        id: `${lesson.id}::${block.id}`,
        lessonId: lesson.id,
        displayOrder: index,
        kind: 'instruction',
        contentVersion: lesson.contentVersion,
        payload: block,
      }),
    ),
    ...lesson.activities.map((activity, index) =>
      storedLessonItemSchema.parse({
        id: `${lesson.id}::${activity.id}`,
        lessonId: lesson.id,
        displayOrder: index,
        kind: 'activity',
        contentVersion: lesson.contentVersion,
        payload: activity,
      }),
    ),
  ]);
  const versionRecord = contentVersionRecordSchema.parse({
    id: 'packaged-content',
    version: validated.version,
    installedAt: Date.now(),
  });

  try {
    await database.transaction(
      'rw',
      [
        database.sections,
        database.units,
        database.lessons,
        database.lessonItems,
        database.contentVersions,
      ],
      async () => {
        await database.sections.bulkPut(validated.sections);
        await database.units.bulkPut(validated.units);
        await database.lessons.bulkPut(lessons);
        await database.lessonItems.bulkPut(items);
        await database.contentVersions.put(versionRecord);
      },
    );
  } catch (error) {
    throw new ContentInitializationError('Lesson content could not be stored on this device.', {
      cause: error,
    });
  }

  return validated;
}

export async function getLesson(
  database: AltrasDatabase,
  lessonId: string,
): Promise<LearningLesson> {
  const metadata = storedLessonSchema.parse(await database.lessons.get(lessonId));
  const items = (
    await database.lessonItems.where('lessonId').equals(lessonId).sortBy('displayOrder')
  )
    .map((item) => storedLessonItemSchema.parse(item))
    .filter((item) => item.contentVersion === metadata.contentVersion);

  return lessonSchema.parse({
    ...metadata,
    instructionalContent: items
      .filter((item) => item.kind === 'instruction')
      .map((item) => item.payload),
    activities: items.filter((item) => item.kind === 'activity').map((item) => item.payload),
  });
}

export async function getAllLessons(database: AltrasDatabase): Promise<LearningLesson[]> {
  const metadata = await database.lessons.orderBy('[unitId+displayOrder]').toArray();
  return Promise.all(metadata.map((lesson) => getLesson(database, lesson.id)));
}
