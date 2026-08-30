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
5. Copy the project URL and publishable key from **Project Settings > API Keys**.
6. Create `.env.local` from `.env.example` and add those two public values.

Never place the `service_role` key in the Vite app, Git repository, or Vercel browser environment.

## Vercel

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project environment variables.
Redeploy only after the database migration and application tests pass.

## Researcher access

New accounts are always students. Promote an approved researcher manually in the Supabase SQL editor:

```sql
update public.profiles
set role = 'researcher', updated_at = now()
where username = 'approved_researcher_username';
```

The researcher role is read-only under the current scope. Editing lessons, managing users, exports,
and advanced analytics require a separately scoped admin system.
