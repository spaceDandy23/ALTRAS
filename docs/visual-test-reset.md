# ALTRAS visual-test data setup

This is an explicit, manual Supabase operation. It is not run by application startup.

## 1. Review the Auth reset plan

From the ALTRAS repository in PowerShell, set the project URL and **service-role** key in the current shell. Do not commit the key or put it in a command history file.

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"
node scripts/reset-test-users.mjs
```

The default is a dry run. It verifies that exactly one Auth account/profile exists for each protected username (`admin`, `testresearcher`) and lists the number of other Auth accounts scheduled for removal. It fails closed if either protected account is missing or ambiguous.

After checking that output, execute the deletion:

```powershell
node scripts/reset-test-users.mjs --confirm-reset
```

Deletion uses the Supabase Auth Admin API. Auth foreign keys in the project use `ON DELETE CASCADE`, which removes each deleted user's profile, settings, researcher/admin membership, lesson progress and attempts, activity answers, assessment attempts/answers, active-time segments, streak days, and related results. Auth deletion is sequential; if a call fails partway, fix the reported issue and rerun. Already-deleted accounts are absent from the next plan, while the two protected accounts are checked before any deletion starts.

After the server reset, close ALTRAS in each visual-testing browser and remove its local IndexedDB database (`altras-content`) from DevTools → Application → IndexedDB. This clears orphaned local lesson/assessment drafts and cached content on that device; the published CMS content remains in Supabase and will be cached again on the next online lesson start. Repeat per browser/device used for testing.

## 2. Review and apply the temporary lesson seed

First inspect linked migration state:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

If the dry run shows the expected pending migrations, apply them:

```powershell
npx supabase db push --linked
```

The new migration is `202611050001_visual_test_lessons.sql`. It publishes five lessons in order and unpublishes any other catalog entries without deleting their authored drafts, private keys, published versions, or historical student records. It retains the existing Operation Signals and Order Matters source content and versions, then publishes updated versions for their new positions. The three newly authored lessons and their assessments are clearly marked as temporary visual-test content.

The migration is transactional. It does not reset Auth users or student data, and it does not change application code or progression/scoring behavior.
