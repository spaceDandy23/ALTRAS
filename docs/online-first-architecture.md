# Online-first data architecture

Supabase is authoritative for authentication, profiles, student settings, lesson progress,
lesson attempts and history, assessments, and researcher results. Failed online writes are
reported to the interface and are never replaced with a browser-only success path.

Browser storage has two non-authoritative roles:

- Dexie database `altras-content` caches validated bundled sections, units, lessons, lesson items,
  and the packaged-content version. It contains no account or student outcome tables.
- `localStorage` caches only theme, readability scale, and animation preference. Entries and the
  active cache identity are keyed by the authenticated Supabase user ID. Login and session restore
  apply that user's cache before loading settings; Supabase then reconciles it. Logout removes the
  active identity.

The previous `altras-local` database is no longer opened by the application. Existing browser data
is left untouched rather than being destructively deleted at startup, but it cannot authenticate a
user or affect application state.

The PWA manifest, service worker, Workbox app-shell caching, and installability remain enabled.
PWA caching does not provide offline authoritative writes.

## Preview QA checklist

- Register a new student and confirm the Supabase Auth user, profile, settings, and initial progress rows.
- Log out and back in; confirm the same profile and progress return.
- Switch between two accounts; confirm profile, theme, text size, progress, and active attempts never cross accounts.
- Refresh on light/dark theme and each text size; confirm the cached appearance applies immediately and then matches Supabase.
- Change settings, wait for Saved, refresh, and confirm the values persist. Disconnect and confirm failed saves show an error.
- Complete Lesson 1, confirm score/stars/XP and Lesson 2 unlock, then refresh and sign in on another device to confirm persistence.
- Start and partially complete a lesson, refresh/re-login, and confirm Resume restores the same Supabase attempt without duplicates.
- Restart a lesson and confirm the prior attempt is abandoned rather than deleted; finish and verify attempt history/result stability.
- Complete pre-test and post-test; verify pending saves block navigation safely and no correct-answer feedback appears mid-test.
- Sign in as an authorized researcher and confirm anonymized, view-only results; confirm a student cannot access that route.
- Disconnect the network; confirm the offline notice appears, cached shell/reference content may render, and authoritative actions fail visibly without a local-success fallback.
- Repeat the primary flows at 1366x768, 1920x1080, and a supported mobile viewport.

No new Supabase migration is required for this frontend cleanup. All existing Supabase migrations
remain required and unchanged.
