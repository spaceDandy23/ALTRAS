# ALTRAS online setup

The production app uses Vercel for the React frontend and Supabase for accounts and student data.
Lesson content stays packaged in the application; a lesson-editing CMS is outside the agreed scope.

## Create the Supabase project

1. Create a project owned by the client group or the agreed turnover account.
2. In **Authentication > Providers > Email**, keep email/password enabled and disable email confirmation.
   ALTRAS converts participant usernames into internal, non-deliverable account identifiers, so it does
   not send account emails.
3. Open the SQL editor and run `supabase/migrations/202608300001_online_foundation.sql`.
4. Run `supabase/migrations/202608300002_transactional_lesson_attempts.sql` to add atomic
   scoring, XP/unlocking updates, restart handling, and active completion-time tracking.
5. Run `supabase/migrations/202608300003_assessment_flow.sql`.
6. Run `supabase/migrations/202608310001_researcher_results.sql`.
7. Run `supabase/migrations/202608310002_researcher_student_separation.sql`.
8. Run `supabase/migrations/202609040001_assessment_answer_draft_upsert.sql` to support
   resumable pre-test and post-test drafts whose answers synchronize in the background.
9. Run `supabase/migrations/202609050001_research_data_integrity.sql` to install private lesson
   answer keys, server-authoritative lesson operations, safe assessment-resume reads, serialized
   assessment answer mutation, and non-destructive progress initialization.
10. Run `supabase/migrations/202609050002_assessment_answer_conflict_fix.sql` to apply the
    PostgreSQL-safe assessment answer upsert conflict target.
11. Copy the project URL and publishable key from **Project Settings > API Keys**.
12. Create `.env.local` from `.env.example` and add those two public values.

Never place the `service_role` key in the Vite app, Git repository, or Vercel browser environment.

## Vercel

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project environment variables.
Apply every migration, including the assessment answer upsert, research-data integrity, and
assessment conflict-fix migrations, before deploying this frontend. The integrity migration changes
RPC signatures and removes the old direct-write grants, so the new frontend and migrations must be
released together, database first. Redeploy only after the database migrations and application tests
pass.

## Researcher access

New accounts are always students. Copy the approved account UUID from
**Authentication > Users**, then grant researcher access in the Supabase SQL Editor:

```sql
insert into public.researcher_users (user_id)
values ('PASTE-USER-UUID-HERE');
```

Revoke access with:

```sql
delete from public.researcher_users
where user_id = 'PASTE-USER-UUID-HERE';
```

Researcher access is view-only and research-only. Editing lessons, managing users,
exports, and advanced analytics require a separately scoped admin system.
