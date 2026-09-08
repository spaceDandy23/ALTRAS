# ALTRAS phase plan

## Confirmed assumptions

- ALTRAS targets landscape desktop and laptop browsers, with 1366×768 and 1920×1080 as primary review sizes.
- ALTRAS is online-first: Supabase provides authentication, assessment data, and persisted progress.
- Multiple students have isolated accounts on the same device; one student signs in at a time.
- Authentication is server-backed by Supabase for participants and researchers, with no browser-only authentication path.
- Assessments, progress, and settings require an internet connection for full functionality.
- The Canva concepts guide the charcoal chalkboard atmosphere and learning interactions, not the literal layout or full feature scope.
- Stable packaged-content IDs are contracts. Compatible IDs preserve progress; semantic breaking changes require new IDs or explicit migrations.

## Phase 1 foundation retained

- React, TypeScript, Vite, React Router, Tailwind CSS, custom CSS, and installable PWA
- Non-authoritative Dexie/IndexedDB content cache and user-scoped assessment recovery drafts with Zod validation
- Supabase authentication and session restoration
- Protected routes and user-ID-isolated visual-preference caching
- Main menu, student profile, per-user settings, and reusable UI components
- Vitest, Testing Library, ESLint, and Prettier tooling

## Phase 2 implemented scope

- Strongly typed Section → Unit → Lesson content schema
- Safe instructional paragraphs, examples, and warnings with no HTML payloads
- Discriminated `find-word` and `organize-translate` activity union
- Zod-validated, versioned, idempotent local content initialization
- Dexie content/recovery schema; progress, attempts, and final assessment results are authoritative in Supabase
- One six-activity introductory lesson and one prerequisite-gated five-activity `Order Matters` lesson
- Lesson hub, overview/instruction board, active player, and result page; the legacy preview URL redirects to the normal lesson overview
- Immediate answer persistence, session recovery, resume, confirmed restart, and preserved abandoned history
- Centralized evaluation, scoring, stars, passing, unlocking, and XP policies
- Best-result protection, improvement-only XP, and idempotent completion
- Charcoal/near-black design tokens applied across Phase 1 and Phase 2 screens
- Keyboard-operable activities, visible focus states, reduced-motion support, and concise corrective feedback
- Protected Almanac linked only from the lesson hub, with a searchable, locally bundled Math Word List

## Content and versioning decisions

- Packaged content is bundled TypeScript and requires stable string IDs.
- `PACKAGED_CONTENT_VERSION` records the educational release independently from the content-cache schema.
- Lesson metadata is stored separately from ordered lesson items so navigation can change without changing scoring or progress.
- Initialization validates the entire manifest before opening a write transaction and uses upserts to avoid duplicates.
- Progress and attempts are not reseeded or deleted when content updates.
- Lesson content updates must bump the lesson content version. Removed older-version items are ignored when reconstructing the current lesson.
- Future incompatible semantic changes should use new IDs or a reviewed migration, especially if active attempts exist.

### Phase 2.2 content expansion

- `PACKAGED_CONTENT_VERSION` is 2 and is independent from the Dexie schema version.
- Lesson 2 retains the stable `lesson-order-matters` ID and its Lesson 1 prerequisite, so existing unlock progress remains valid.
- Its learning objective is to translate phrases where spoken order affects mathematical order: “less than,” “subtracted from,” “more than,” and “the difference of A and B.”
- The lesson contains two Find-the-Word activities and three Organize-and-Translate activities, for five activities total.
- Initialization upserts only bundled metadata and items; student data remains in Supabase.
- There is currently no Lesson 3. Additional lessons remain deferred until finalized educational content is provided.

### Phase 2.3 Math Word List

- The protected hierarchy is `/lessons` → `/lessons/almanac` → `/lessons/almanac/word-list`; each page returns to its parent.
- Almanac shows the available Word list and a disabled Review entry marked `Coming next`. `/lessons/almanac/review` is reserved and safely redirects to Almanac until Review is implemented.
- Typed, Zod-validated application data covers addition, subtraction, multiplication, and division symbols, keywords, examples, and order guidance.
- Client-side search matches operation names, symbols, keywords, examples, and guidance without network requests or stored search history.
- “Less than” and “subtracted from” are explicitly labeled order-sensitive; division and named-difference order are also explained.
- The reference requires no Dexie table or migration and does not read or mutate lesson attempts, progress, XP, stars, settings, or sessions.
- `PACKAGED_CONTENT_VERSION` remains 2 because lesson content did not change.

## Policies

### Score, stars, and clearing

- Score: rounded correct-first-submission count divided by total activity count.
- Below 70%: failed, zero stars.
- 70–84%: cleared, one star.
- 85–99%: cleared, two stars.
- 100%: cleared, three stars.
- A later lower attempt never decreases the stored best score or stars.
- A lesson becomes available only when its prerequisite progress is `cleared`.

### XP

- Lesson XP = best score + (best stars × 10).
- Maximum for the current lesson is 130 XP.
- Attempts store only the positive improvement over previously derived XP.
- Equal or lower performance cannot farm XP.
- Total XP is calculated from per-lesson best-progress records.

### Attempt recovery

- Submitted answers are persisted immediately and cannot be overwritten by repeated submission.
- Resume returns the single active attempt for that user and lesson.
- Restart requires confirmation and marks existing active attempts `abandoned` rather than deleting them.
- Completion is transactional and idempotent, preventing duplicate attempt counts, XP, or unlocks after refresh or repeated navigation.

## Data storage and sync

**Authoritative online data (Supabase):**

- User accounts and authentication
- Assessment attempts and scores
- Lesson progress and XP
- User settings and profile changes

**Local caches:**

- Lesson content (packaged and cached)
- User-scoped, revisioned assessment drafts used only for recovery and pending synchronization
- App shell and static assets
- User-ID-keyed theme, readability, and motion preferences

**Researcher authorization:**

- `researcher_users` is the single researcher allow-list.
- `is_researcher()` applies that authority to RLS and secured RPC access.
- Profiles contain participant identity/display data, not authorization roles.
- Researcher accounts remain view-only and cannot enter participant learning or Settings flows.

**Limitations without internet:**

- Cannot authenticate or sync progress
- Cannot submit or retrieve assessments
- Cannot modify profile or settings
- Cached lessons can still be browsed for review
- Device loss or storage corruption cannot be recovered in Phase 2

**Before research testing:**

- Backup/export and validated recovery procedures must be added
- Distribution may remain a PWA or use the same frontend inside a Windows wrapper if installation policies make that necessary

## Deferred Canva ideas

The following remain recorded but intentionally unimplemented: review of mistakes, flashcards, additional quiz types, CSV/Excel export, backup/import, achievements, badges, profile borders, friends, additional character mechanics, progress-reactive backgrounds, adaptive practice, Easter eggs, and automatic question generation.

## Recommended next validation work

Before expanding the product beyond the implemented student and researcher workflows:

1. Complete formal UAT for authentication, lessons, revisioned pre/post-assessments, settings, audio, and the view-only researcher workspace.
2. Validate all migrations in a disposable Supabase project, including old-client/PWA update behavior around the revision-sync release.
3. Confirm grade level, educational content sequence, scoring/XP rules, accessibility accommodations, and research consent requirements.
4. Scope validated backup/export/import separately before relying on the application for irreplaceable research data.
5. Add more reviewed lessons or optional engagement features only after the current learning loop is evaluated.

## Questions still awaiting answers

- What grade range and reading level should future content target?
- Which additional lesson sequence should follow “Order Matters”?
- Are the provisional passing, star, and XP policies acceptable?
- What accessibility accommodations are required beyond keyboard access, contrast, and reduced motion?
- Which identifiers and fields may appear in research exports, and what consent process governs them?
- Will target classroom computers allow PWA installation, or should a Windows wrapper become primary?
