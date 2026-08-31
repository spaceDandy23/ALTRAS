# Researcher results access

Phase 4 exposes anonymized, view-only participant results at /researcher/results.
It uses the signed-in user's Supabase JWT and database Row Level Security; the
browser never receives a Supabase service-role or secret key.

Apply supabase/migrations/202608310001_researcher_results.sql in the Supabase
SQL Editor (or through the Supabase CLI) after the existing online migrations.

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
tables are removed by the migration.
