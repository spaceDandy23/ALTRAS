# AGENTS.md

## Project

ALTRAS is an educational mathematics web app with:

- Student experience
- Researcher/admin CMS
- Supabase backend
- Dexie/local offline support
- PWA behavior

The current branch is:

`feat/online-foundation`

---

## Core Architecture Rules

### Supabase

Supabase is authoritative for:

- authentication/session
- user profiles
- student settings
- lesson progress
- scores
- stars
- XP
- lesson unlocks
- attempts/history
- assessments
- researcher results

Do not introduce client-only authoritative progression logic.

Use migrations for database changes.

Preserve existing RLS/security boundaries.

---

## Student vs Researcher Experience

Keep student and researcher experiences separate.

Researchers/admins:

- use the researcher CMS/layout
- must not receive student BGM or student-only UI
- may manage lesson/content data only through authorized paths

Students must never receive CMS mutation access.

---

## Lesson Progression

The **Lesson is the main progression unit**.

Do not create chapter-level:

- XP
- stars
- lesson unlocks
- independent lesson attempts

unless explicitly requested.

Current intended lesson structure:

```text
Lesson
├── Pre-test
├── Chapters
│   ├── Teaching / discussion
│   └── Activities
└── Post-test
```

Chapters organize lesson content.

Preserve existing lesson IDs, attempts, progress, scores, and history during migrations.

---

## Activities

Existing activity types must remain compatible.

Do not invent or add new activity types unless explicitly requested.

Current planned activity work may include:

- multiple valid correct answers
- original third activity type

Manual typed/completion answers, hearts/lives, timers, hints, and similar mechanics are separate scope unless explicitly requested.

---

## Offline / Dexie

ALTRAS is online-first but supports offline lesson/assessment work.

Supabase remains authoritative.

Preserve:

- durable local drafts
- pending sync queues
- idempotent retries
- safe reconnect behavior
- user + lesson + attempt isolation
- existing resume/retry behavior

Do not silently drop offline progress.

Do not redesign offline architecture unless required.

---

## Audio

Student audio uses existing audio architecture.

Preserve:

- student-only BGM
- mute/volume settings
- researcher silence
- result SFX semantics
- autoplay handling

Do not rewrite audio systems for simple asset changes.

---

## CMS

CMS changes should:

- follow existing UI patterns
- avoid unnecessary redesigns
- preserve authorization
- support safe destructive actions with confirmation
- preserve existing content where possible

Prefer extending existing lesson/content models over introducing parallel systems.

---

## Implementation Style

Before editing:

1. Inspect the current implementation.
2. Trace the actual data flow.
3. Identify the authoritative source of state.
4. Avoid assuming architecture from the task description.

When implementing:

- make the smallest correct change
- avoid unrelated refactors
- preserve backward compatibility
- do not duplicate existing systems
- fix root causes, not symptoms
- keep existing naming/conventions where reasonable

## Layout / Spacing Rules

For UI changes:

- Do not rely on tight fixed-width horizontal layouts for variable text.
- Prefer `gap` over manual margins between sibling controls.
- Allow text and content to wrap or shrink safely where appropriate.
- Buttons must not overlap labels, counters, or adjacent controls.
- Test narrow and wide viewport behavior for changed layouts.
- Preserve clear spacing between navigation controls and status text.
- Avoid absolute positioning for normal document flow unless necessary.
- For flex layouts, explicitly consider `min-width: 0`, wrapping, shrinking, and responsive stacking.
- Check long labels and disabled button states before considering UI work complete.

Previous/current/next navigation rows must keep the progress label separated from both navigation buttons and stack gracefully on narrow widths.

---

## Database Changes

For schema changes:

- use Supabase migrations
- preserve existing IDs/data
- do not reset student progress
- do not delete production data unnecessarily
- consider backward compatibility
- update relevant types, RPCs, tests, and docs

---

## Testing

Run focused tests for changed behavior.

For meaningful changes also run:

- full test suite
- TypeScript/typecheck
- lint
- production build

Report any failures clearly and distinguish pre-existing failures from regressions.

---

## Git Safety

Do not commit unless explicitly requested.

Do not push unless explicitly requested.

Never use destructive broad commands such as:

- `git reset --hard`
- `git restore .`

The working tree may contain valid unrelated changes.

---

## Scope Discipline

Do not implement adjacent requested ideas automatically.

If a task says Phase 1, implement Phase 1 only.

Do not silently include:

- hearts/lives
- timers
- timed hints
- manual typed-answer activities
- reward systems
- major navigation redesigns
- unrelated questionnaire-driven features

unless explicitly requested.

---

## Response Format

After implementation, report only what is useful:

1. what changed
2. important files/migrations
3. architecture decisions
4. validation results
5. anything blocking the next phase

Keep reports concise.
