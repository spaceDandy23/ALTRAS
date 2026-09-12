# Researcher results access

Phase 4 exposes the researcher workspace at `/researcher`, with anonymized, view-only
participant results at `/researcher/participants`. The former `/researcher/results`
address remains only as a compatibility redirect to the participant page.
It uses the signed-in user's Supabase JWT and database Row Level Security; the
browser never receives a Supabase service-role or secret key.

Apply these migrations in order in the Supabase SQL Editor (or through the
Supabase CLI) after the existing online migrations:

1. `supabase/migrations/202608310001_researcher_results.sql`
2. `supabase/migrations/202608310002_researcher_student_separation.sql`
3. `supabase/migrations/202609080001_researcher_role_cleanup.sql`
4. `supabase/migrations/202609080002_repair_handle_new_user_after_role_cleanup.sql`
5. `supabase/migrations/202609080003_support_manual_auth_user_provisioning.sql`

The follow-up migration fixes anonymous participant-code generation for the
RPC's locked-down `search_path`, excludes researcher accounts from participant
results, and blocks researchers from participant learning writes at the database
level. The cleanup migration then removes the superseded `profiles.role` field and
`app_role` enum; `researcher_users` remains the only researcher authorization source.
The follow-up trigger repair preserves normal profile/settings creation for new Auth users
without adding anyone to `researcher_users`.
The manual-provisioning migration extends that trigger only for Auth users with no ALTRAS
metadata; it still does not add anyone to `researcher_users`.

## Grant access

1. In Supabase Dashboard, open **Authentication → Users** and copy the intended
   researcher's user UUID.
2. Run this SQL in the Supabase SQL Editor:

```sql
insert into public.researcher_users (user_id)
values ('PASTE-USER-UUID-HERE');
```

The user must sign out and sign back in, or refresh the results route, for the
client to re-check their access.

## Revoke access

```sql
delete from public.researcher_users
where user_id = 'PASTE-USER-UUID-HERE';
```

There is intentionally no in-app role-management screen. Only database
administrators can grant or revoke access.

## Data protection

The get_researcher_results RPC checks the current auth.uid against
researcher_users inside the database and returns only anonymous participant
codes, scored assessment summaries, and lesson progress. It does not return
email addresses, display names, authentication UUIDs, answers, or answer keys.
Direct researcher reads of participant profile, progress, attempt, and answer
tables are removed by the migrations. Researcher accounts do not enter student
Profile, Settings, lesson, or assessment routes; those routes redirect them to the
researcher workspace, and database triggers
reject attempts, progress, assessment, XP, and star updates.

The Phase 4 dashboard receives one secure anonymized result set because its
summary, search, filters, and sorting all operate across the same compact research
cohort. The browser renders 15 participants per page, and opening a detail dialog
reuses the selected row's existing data without another request. If the study
grows beyond a compact cohort, move pagination, filtering, and summary aggregation
into a parameterized replacement RPC rather than exposing direct table access.
