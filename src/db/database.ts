import Dexie, { type EntityTable } from 'dexie';
import type {
  ContentVersionRecord,
  StoredLesson,
  StoredLessonItem,
  StoredSection,
  StoredUnit,
} from '@/types/learning';

export const DATABASE_NAME = 'altras-content';

export class AltrasDatabase extends Dexie {
  sections!: EntityTable<StoredSection, 'id'>;
  units!: EntityTable<StoredUnit, 'id'>;
  lessons!: EntityTable<StoredLesson, 'id'>;
  lessonItems!: EntityTable<StoredLessonItem, 'id'>;
  contentVersions!: EntityTable<ContentVersionRecord, 'id'>;

  constructor(name = DATABASE_NAME) {
    super(name);

    this.version(1).stores({
      sections: 'id,displayOrder,contentVersion',
      units: 'id,sectionId,[sectionId+displayOrder],contentVersion',
      lessons:
        'id,sectionId,unitId,[unitId+displayOrder],prerequisiteLessonId,contentStatus,contentVersion',
      lessonItems: 'id,lessonId,[lessonId+displayOrder],kind,contentVersion',
      contentVersions: 'id,version,installedAt',
    });
  }
}

export const db = new AltrasDatabase();
