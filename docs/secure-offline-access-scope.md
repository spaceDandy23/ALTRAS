# Secure offline access — separate batch scope

Status: design scope only. No authentication or route-guard changes are included in the
local-first Pre-test/activity repair batch.

## Problem

Lesson drafts can restore without network requests, but a cold application reload still runs
`restoreOnlineSession`, `ResolvedExperienceRoute`, and `StudentRoute`. Session/profile restoration
or the researcher/admin access checks can fail offline before the cached lesson is mounted.
Remembering a username or a `student` flag in browser storage is not sufficient authorization.

## Proposed boundary

Issue a short-lived, server-signed offline lesson capability when an authenticated student
successfully starts or prepares an owned lesson attempt online. A server endpoint must validate
the Supabase session, account eligibility, absence of researcher/admin membership, attempt
ownership/status, and the pinned lesson version before issuing it.

The signed payload binds the user ID, lesson ID/version, attempt ID, intended application,
issuance/expiry times, and the specific permission to resume cached local lesson work. It contains
no password, refresh token, assessment keys, score, XP, or authorization to call server mutations.
Use an asymmetric signature with a server-only signing key; the client verifies against a trusted
public key shipped with the application. Do not accept a verification key supplied by the same
local record being verified.

Persist the capability with the existing attempt package. On a cold offline reload, a narrow
offline-lesson gate may render that exact cached attempt only after validating the signature,
claims, expiry, and matching user/lesson/attempt/version in local storage. This is a separate
local-recovery mode, not `authenticated` in the existing auth store. General account pages,
researcher/admin routes, new lesson starts/retries, and online mutations still require normal
authentication and authorization.

On reconnect, restore and validate the real Supabase session and current role/account state
before enabling background sync. Every existing RPC/RLS check remains authoritative. If the
session belongs to a different user or access was revoked, preserve the old pending draft without
uploading it under the new identity. Explicit logout/account switch invalidates local capabilities
without deleting pending answers. Expiry or signature failures show a reconnect/sign-in action.

## Implementation scope

1. Add the narrow capability-issuance endpoint and signing-key configuration. Do not reuse a
   service-role key as a signing secret or expose server secrets to the client.
2. Extend the pinned attempt record with the signed capability; preserve older drafts without it.
3. Add the offline-only route gate and local identity context. Do not loosen existing online,
   researcher, or admin guards.
4. Resume the existing lesson/assessment drafts and synchronizers after online verification.
   Do not introduce another progress queue.
5. Keep service-worker asset caching separate. A valid capability cannot load missing app assets
   or missing lesson content; report that condition honestly.

## Decisions and limits before implementation

- Choose a maximum offline validity period and document its tradeoff. Server-side deactivation
  cannot be detected without connectivity during that period.
- Define signing-key rotation and how already-installed/offline clients receive trusted new keys.
- Browser clocks and browser storage are user-controlled. Offline expiry checks are not a trusted
  clock; local-device compromise and access to already-cached data remain explicit limits.
- Determine shared-device/logout behavior and whether device binding is required. A signed grant
  is not proof that the person reopening the browser is the original student.
- No capability may award official progress or override current server rejection on reconnect.

## Acceptance tests

- Verified student + valid capability + cached attempt: cold offline reload restores the same
  Pre-test/chapter/activity position without remote role checks.
- Forged/modified/expired capability, wrong user/attempt/version, missing package, or unknown
  signing key: no offline lesson admission and no local data deletion.
- Researcher/admin/guest: cannot obtain a capability or use it to enter privileged routes.
- Logout, account switch, deactivation, and role changes: reconnect revalidates before sync;
  another user's pending work is never replayed under the current session.
- Lost responses and repeated reload/reconnect retain the existing idempotency/reward guarantees.
- Full browser offline QA, including a cold reload with cached PWA assets, supplements unit tests.
