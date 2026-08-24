import Dexie, { type EntityTable } from 'dexie';
import type { LocalSession, LocalUser, StudentProfile, UserSettings } from '@/types/models';
import type {
  ContentVersionRecord,
  LessonAttempt,
  LessonProgress,
  StoredLesson,
  StoredLessonItem,
  StoredSection,
  StoredUnit,
} from '@/types/learning';

export const DATABASE_NAME = 'altras-local';

export class AltrasDatabase extends Dexie {
  users!: EntityTable<LocalUser, 'id'>;
  profiles!: EntityTable<StudentProfile, 'id'>;
  settings!: EntityTable<UserSettings, 'id'>;
  sessions!: EntityTable<LocalSession, 'id'>;
  sections!: EntityTable<StoredSection, 'id'>;
  units!: EntityTable<StoredUnit, 'id'>;
  lessons!: EntityTable<StoredLesson, 'id'>;
  lessonItems!: EntityTable<StoredLessonItem, 'id'>;
  contentVersions!: EntityTable<ContentVersionRecord, 'id'>;
  lessonProgress!: EntityTable<LessonProgress, 'id'>;
  lessonAttempts!: EntityTable<LessonAttempt, 'id'>;

  constructor(name = DATABASE_NAME) {
    super(name);

    // Keep each version declaration additive. Future lesson/progress tables can be
    // introduced without replacing or rewriting existing student records.
    this.version(1).stores({
      users: 'id,&normalizedUsername,createdAt,lastLoginAt',
      profiles: 'id,&userId,updatedAt',
      settings: 'id,&userId,updatedAt',
      sessions: 'id,userId,createdAt,lastAccessedAt,expiresAt',
    });

    this.version(2).stores({
      users: 'id,&normalizedUsername,createdAt,lastLoginAt',
      profiles: 'id,&userId,updatedAt',
      settings: 'id,&userId,updatedAt',
      sessions: 'id,userId,createdAt,lastAccessedAt,expiresAt',
      sections: 'id,displayOrder,contentVersion',
      units: 'id,sectionId,[sectionId+displayOrder],contentVersion',
      lessons:
        'id,sectionId,unitId,[unitId+displayOrder],prerequisiteLessonId,contentStatus,contentVersion',
      lessonItems: 'id,lessonId,[lessonId+displayOrder],kind,contentVersion',
      contentVersions: 'id,version,installedAt',
      lessonProgress: 'id,&[userId+lessonId],userId,lessonId,status,clearedAt',
      lessonAttempts: 'id,[userId+lessonId],userId,lessonId,status,lastUpdatedAt,completedAt',
    });
  }
}

export const db = new AltrasDatabase();
