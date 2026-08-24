# ALTRAS phase plan

## Confirmed assumptions

- ALTRAS targets landscape desktop and laptop browsers, with 1366×768 and 1920×1080 as primary review sizes.
- It remains fully usable without a server or internet connection after its application shell is cached.
- Multiple students have isolated local accounts and lesson records; one student is signed in at a time.
- Authentication is a local shared-computer privacy boundary, not server-backed identity verification.
- The Canva concepts guide the charcoal chalkboard atmosphere and learning interactions, not the literal layout or full feature scope.
- Stable packaged-content IDs are contracts. Compatible IDs preserve progress; semantic breaking changes require new IDs or explicit migrations.

## Phase 1 foundation retained

- React, TypeScript, Vite, React Router, Tailwind CSS, custom CSS, and installable PWA
- Versioned Dexie/IndexedDB database and Zod validation
- PBKDF2-SHA-256 local authentication, protected routes, and session restoration
- Main menu, student profile, per-user settings, offline indicator, and reusable UI components
- Vitest, Testing Library, ESLint, and Prettier tooling

## Phase 2 implemented scope

- Strongly typed Section → Unit → Lesson content schema
- Safe instructional paragraphs, examples, and warnings with no HTML payloads
- Discriminated `find-word` and `organize-translate` activity union
- Zod-validated, versioned, idempotent local content initialization
- Additive Dexie v2 migration with content, progress, and attempt tables
- One six-activity introductory lesson and one prerequisite-gated five-activity `Order Matters` lesson
- Lesson hub, overview/instruction board, active player, and result page; the legacy preview URL redirects to the normal lesson overview
- Immediate answer persistence, session recovery, resume, confirmed restart, and preserved abandoned history
- Centralized evaluation, scoring, stars, passing, unlocking, and XP policies
- Best-result protection, improvement-only XP, and idempotent completion
- Charcoal/near-black design tokens applied across Phase 1 and Phase 2 screens
- Keyboard-operable activities, visible focus states, reduced-motion support, and concise corrective feedback

## Content and versioning decisions

- Packaged content is bundled TypeScript and requires stable string IDs.
- `PACKAGED_CONTENT_VERSION` records the educational release independently from Dexie schema version 2.
- Lesson metadata is stored separately from ordered lesson items so navigation can change without changing scoring or progress.
- Initialization validates the entire manifest before opening a write transaction and uses upserts to avoid duplicates.
- Progress and attempts are not reseeded or deleted when content updates.
- Lesson content updates must bump the lesson content version. Removed older-version items are ignored when reconstructing the current lesson.
- Future incompatible semantic changes should use new IDs or a reviewed migration, especially if active attempts exist.

### Phase 2.2 content expansion

- `PACKAGED_CONTENT_VERSION` is 2; the Dexie schema remains version 2 because this is a packaged-content update, not a storage-shape change.
- Lesson 2 retains the stable `lesson-order-matters` ID and its Lesson 1 prerequisite, so existing unlock progress remains valid.
- Its learning objective is to translate phrases where spoken order affects mathematical order: “less than,” “subtracted from,” “more than,” and “the difference of A and B.”
- The lesson contains two Find-the-Word activities and three Organize-and-Translate activities, for five activities total.
- Initialization upserts the new metadata and items without modifying accounts, sessions, settings, attempts, or progress.
- There is currently no Lesson 3. Additional lessons remain deferred until finalized educational content is provided.

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

## Offline-storage limitations

- Data is isolated per browser and computer.
- Clearing browser/site data can remove accounts, progress, and attempts.
- Different computers do not synchronize automatically.
- Device loss or storage corruption cannot be recovered in Phase 2.
- Backup/export will be added before research testing.
- Distribution may remain a PWA or use the same frontend inside a Windows wrapper if installation policies make that necessary.

## Deferred Canva ideas

The following remain recorded but intentionally unimplemented: Glossary/List, review of mistakes, flashcards, additional quiz types, pre/post-tests, researcher results, CSV/Excel export, backup/import, achievements, badges, profile borders, friends, characters and mechanics, themes, progress-reactive backgrounds, final music/sound, adaptive practice, Easter eggs, cross-computer sync, and automatic question generation.

## Recommended Phase 3

Phase 3 should begin with research readiness rather than broad gamification:

1. Confirm grade level, educational content sequence, scoring/XP rules, accessibility accommodations, and research consent fields with the students.
2. Add validated backup/export/import before any classroom or research testing.
3. Add more reviewed lessons using the existing two activity types and introduce attempt-history/review summaries.
4. Add pre/post-assessment only after content and research requirements are approved.
5. Consider badges, achievements, or additional activity types only after the core learning loop is evaluated with students.

## Questions still awaiting answers

- What grade range and reading level should future content target?
- Which additional lesson sequence should follow “Order Matters”?
- Are the provisional passing, star, and XP policies acceptable?
- What accessibility accommodations are required beyond keyboard access, contrast, and reduced motion?
- Which identifiers and fields may appear in research exports, and what consent process governs them?
- Will target classroom computers allow PWA installation, or should a Windows wrapper become primary?
