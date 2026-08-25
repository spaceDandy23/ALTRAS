# ALTRAS

ALTRAS is an offline-first educational desktop web application that teaches students how to translate verbal phrases and word problems into mathematical expressions. Phase 2 provides a complete local learning loop with validated bundled lessons, two playable activity types, persisted attempts, scoring, stars, XP, and prerequisite unlocking.

> ALTRAS accounts are local device accounts. They are not online identities, and no server verifies or synchronizes them.

## Requirements and setup

- Node.js 22.12 or newer (Node.js 24 is supported)
- npm 11 or newer
- A current Chromium, Firefox, or Safari browser with IndexedDB, Web Crypto, and service-worker support

```bash
npm install
npm run dev
```

The interface targets landscape laptop and desktop screens with a minimum width of 1024 px.

## Quality checks

```bash
npm run format:check
npm run lint
npm test
npm run test:coverage
npm run build
```

Preview the production build with `npm run preview`.

## Offline installation

1. Run `npm run build`, then `npm run preview`.
2. Open ALTRAS once and wait for the brief **Offline ready** confirmation in the header. It disappears after a few seconds.
3. Use the browser's **Install app** action.
4. Close and reopen the installed app with the network disabled.

ALTRAS has no remote fonts, APIs, CDNs, content requests, or server runtime. The bundled app shell and lesson content remain available offline.

## Learning content model

Packaged content lives in [`src/features/lessons/content/packaged-content.ts`](src/features/lessons/content/packaged-content.ts) and is validated by discriminated Zod schemas in [`content.schemas.ts`](src/features/lessons/domain/content.schemas.ts).

The hierarchy is:

```text
Section → Unit → Lesson → instructional blocks and activities
```

Lessons use stable string IDs, a content version, prerequisite ID, passing threshold, concepts, safe text-only instructional blocks, and activities. The current packaged-content version is 2. Phase 2 supports:

- `find-word`: choose a stable choice ID to complete a verbal statement.
- `organize-translate`: arrange stable token IDs into an exact verbal sequence without requiring drag-and-drop.

### Adding or editing a lesson

1. Add or update the section, unit, and lesson objects in `packaged-content.ts`.
2. Give every content entity, block, activity, choice, and token a stable ID.
3. Never place HTML or executable code in lesson data.
4. Increase the lesson's `contentVersion` whenever its activities or instructional blocks change.
5. Increase `PACKAGED_CONTENT_VERSION` for every packaged release.
6. Run the tests and production build. Invalid content fails before any content rows are written.

Initialization uses `bulkPut`, so repeated runs are idempotent. Student progress and attempts live in separate tables and are never removed during content updates. Stable compatible IDs preserve progress. A future breaking change should introduce a new lesson/activity ID or an explicit migration rather than silently changing the meaning of an existing ID.

## IndexedDB and migration

Dexie schema v2 retains the Phase 1 `users`, `profiles`, `settings`, and `sessions` tables and adds:

- `sections`, `units`, `lessons`, and `lessonItems`
- `contentVersions`, separate from the Dexie schema version
- `lessonProgress`, isolated by user and lesson
- `lessonAttempts`, including submitted answers and completion results

A tested v1→v2 upgrade preserves representative accounts, profiles, settings, and sessions. Clearing browser/site data can still permanently remove all records.

## Attempts, scoring, and unlocking

- Meaningful answer changes are written to IndexedDB immediately.
- At most one active attempt is maintained per user and lesson by the attempt service.
- Returning students can resume or confirm a restart. Restarting marks the old attempt abandoned; it never deletes history.
- An activity records only its first explicit submitted answer. Completed attempts are idempotent.
- Score is the rounded percentage of activities answered correctly on the first submission.
- Below 70% gives zero stars and does not clear the lesson.
- 70–84% gives one star, 85–99% gives two stars, and 100% gives three stars.
- A prerequisite unlocks only after it is cleared. Later lower results never replace best score or stars.

XP is deliberately simple: `best score + (best stars × 10)`, for a maximum of 130 XP per lesson. Progress stores the derived best-performance XP; each attempt exposes only the positive improvement. Repeating the same or a lower result awards no additional XP.

## Playable lessons

- **Words That Signal Operations** contains six activities introducing common operation words and order-sensitive phrases.
- **Order Matters** unlocks after the first lesson is cleared. Its five activities practice “less than,” “subtracted from,” “more than,” and subtraction written in named order using the existing Find-the-Word and Organize-and-Translate formats.

Packaged-content version 2 changed Lesson 2 from a preview to a playable lesson while retaining its stable lesson ID and prerequisite. Existing Lesson 1 attempts and progress remain separate from content installation and are preserved.

## Math word list

Authenticated students open **Almanac** from the lesson hub, then choose the fully offline **Word list** at `/lessons/almanac/word-list`. The Almanac keeps the intended `Lessons → Almanac → Review or Word list` hierarchy; Review is disabled and marked **Coming next**. The reference groups addition, subtraction, multiplication, and division vocabulary with examples and explicit guidance for order-sensitive phrases. Search is immediate, case-insensitive, and stored only in page memory.

The reference is typed, Zod-validated application content. It does not use IndexedDB or change packaged lesson version 2, accounts, settings, attempts, progress, XP, stars, or unlocking.

## Current limitations

- Data is isolated per browser and computer; different computers do not synchronize.
- Clearing browser/site data removes local accounts and learning records.
- Backup/import and research export are not available yet.
- Only two lessons and two activity formats are currently available.
- There is no Lesson 3. Additional lessons are deferred until finalized, reviewed content is provided.
- XP values are provisional and there are no levels, streaks, achievements, or leaderboards.

See [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) for the complete scope, deferred ideas, and future phases.
