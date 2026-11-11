# ALTRAS

ALTRAS is a React/TypeScript mathematics learning app for translating verbal phrases into algebraic expressions. It includes a student lesson experience, researcher reporting, an administrator CMS, Supabase-backed authentication and progression, and local-first recovery for lesson work.

## Requirements

- Node.js 22.12 or newer
- npm 11 or newer
- A current browser with IndexedDB and service-worker support
- A Supabase project for authentication, content, attempts, and reporting

```bash
npm install
npm run dev
```

The local app is available at `http://localhost:5173` by default.

## Supabase setup

Create `.env.local` from `.env.example`, link the project, and apply migrations:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --linked
```

Username login for manually provisioned accounts uses a rate-limited Edge Function. Configure its allowed web origins and a long random hashing salt, then deploy it:

```bash
npx supabase secrets set ALTRAS_ALLOWED_ORIGINS=http://localhost:5173,https://your-app.example
npx supabase secrets set LOGIN_RATE_LIMIT_SALT=<long-random-secret>
npx supabase functions deploy username-login --no-verify-jwt
```

The function is intentionally public because it is the login endpoint. It resolves identities with service-role-only database functions, applies per-address and per-username limits, and verifies passwords through the normal Supabase Auth sign-in endpoint. Never expose the service-role key in browser environment variables.

## Application structure

The student lesson flow is:

```text
Lesson overview
â”œâ”€â”€ Pre-test
â”œâ”€â”€ Chapters
â”‚   â”œâ”€â”€ Teaching content
â”‚   â””â”€â”€ Activities
â”œâ”€â”€ Activity result
â””â”€â”€ Post-test and official lesson result
```

Lessons and their published versions are server-authored through the administrator CMS. Supported content includes chapter teaching blocks, dynamic tables, lesson-scoped pre/post assessments, and the current activity types. Published versions are immutable for attempts already in progress.

Supabase is authoritative for accounts, lesson content, answers, scores, stars, XP, unlocking, attempts, and researcher results. Dexie stores user/lesson/attempt-scoped drafts and cached published content so accepted local work is not lost during connectivity changes.

## Offline behavior

After an authenticated student starts a lesson online and its package is cached, lesson and assessment work is written locally first. Pending work is replayed idempotently after reconnect, including when the student navigates away. Official scores, stars, XP, clearing, and unlocks remain server-authoritative.

Known boundary: a cold offline launch cannot establish or revalidate an unknown Supabase session/role. The PWA shell can load, but authentication bootstrap requires connectivity. Clearing browser/site data removes local cached work that has not synchronized; it does not remove server records.

## Scoring and attempts

- Lesson attempt limits are configurable per published lesson; the server enforces them.
- `0â€“49%` gives 0 stars.
- `50â€“75%` gives 1 star.
- `76â€“99%` gives 2 stars.
- `100%` gives 3 stars.
- XP, rewards, best results, prerequisites, and retry history are calculated and preserved by Supabase.

## Workspaces

- **Students:** Home, Lessons, Almanac/Math Word List, Profile, and Settings.
- **Researchers:** view-only participant, assessment, lesson, and report views.
- **Administrators:** account provisioning and lesson/assessment/Math Word List authoring.

Researcher and administrator authorization use their dedicated membership tables and secured RPCs. They do not receive student progression records or student audio behavior.

## Temporary visual-test content

Migration `202611050001_visual_test_lessons.sql` historically created and published demo curriculum. Migration `202611110002_unpublish_visual_test_lessons.sql` safely unpublishes any of those known lessons that still contain explicit temporary markers. It preserves drafts, immutable lesson definitions, attempts, and progress. Publish approved curriculum through the CMS before client testing.

## Quality checks

```bash
npm test
npm run lint
npm run build
npm run format:check
```

Preview the production/PWA build with:

```bash
npm run preview
```
