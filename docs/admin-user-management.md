# Admin User Management

The focused admin workspace exposes `/admin/users` and `/admin/lessons`. Both routes share the existing `AdminRoute`, which confirms `admin_users` membership before rendering and keeps the neutral, silent experience scope. Researcher authorization remains exclusively in `researcher_users`; neither membership implies the other.

## Architecture and security

`202609120003_admin_user_management.sql` installs narrowly scoped SECURITY DEFINER RPCs with an empty search path:

- `admin_list_users` joins `auth.users` to profiles and the two allow-lists, returning only ID, username, display name, email, created/last-sign-in timestamps, ban status and access booleans. Search and 20-row pagination execute in PostgreSQL. Password hashes, tokens and arbitrary Auth metadata are never projected.
- `admin_set_researcher_access` and `admin_set_admin_access` perform idempotent allow-list inserts/deletes after checking the calling JWT through `is_admin()`.
- `admin_set_admin_access` serializes changes and refuses to remove an admin unless another unbanned admin remains. Banned users cannot be granted admin access.
- `admin_assert_user_can_be_banned` refuses self-deactivation and requires admin access to be revoked before an account can be banned. This prevents ban operations from bypassing final-admin protection.
- `is_admin()` now also rejects banned administrators, including while a previously issued JWT has not yet expired. Existing lesson-management RPCs inherit this behavior.

The `admin-users` Edge Function is the only component that uses the service-role credential. Supabase provides `SUPABASE_SERVICE_ROLE_KEY` to the server runtime; it is not a Vite variable and is never bundled into the browser. The function validates the caller JWT, checks `is_admin()`, and then uses the supported Auth Admin `createUser` or `updateUserById` operation. Function JWT verification remains enabled. Browser CORS requests are accepted only from the explicit comma-separated `ALTRAS_ALLOWED_ORIGINS` allow-list.

Provisioning accepts email/password plus optional username/display name. It sends supplied profile fields as Auth user metadata; when omitted, the existing `handle_new_user()` trigger generates the safe unique fallbacks. That trigger creates both `profiles` and default `user_settings`. Researcher/admin access is granted only when the admin explicitly selected it, through the same access RPCs. The submitted password is sent once to the trusted function and is never returned or listed.

Deactivation sets a long Auth ban duration and preserves the Auth row, profile, settings, progress, attempts, answers, XP, stars, streaks and research data. Reactivation uses Auth Admin `ban_duration: 'none'`. Supabase rejects new sign-ins/refreshes for banned users; already issued JWTs can remain usable until their normal expiry, although admin RPCs reject a banned admin immediately. No parallel profile-disabled flag is introduced.

Privilege changes take effect when the affected account next refreshes its experience/auth state. Revocation never deletes account or result data. The existing allow-list timestamp columns (`granted_at` and `created_at`) provide basic grant timing; no expanded audit-log system is added.

## Deployment

The user-management migration depends on the pending Basic Lesson Management migration because it reuses `admin_users` and `is_admin()`. Apply the complete pending chain in order, database first:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase secrets set ALTRAS_ALLOWED_ORIGINS="https://YOUR-PRODUCTION-DOMAIN,https://YOUR-VERCEL-PREVIEW-DOMAIN"
npx supabase functions deploy admin-users --use-api
```

`ALTRAS_ALLOWED_ORIGINS` is the only custom function setting required; list exact origins without trailing slashes and update it when a new Preview origin must access the function. Supabase injects its URL, anonymous/publishable compatibility key, and service-role variables server-side. Never create a `VITE_SUPABASE_SERVICE_ROLE_KEY` or copy a secret/service-role key into Vercel.

Deploy the frontend only after the migration and Edge Function. A frontend deployed first will show failures rather than weakening authorization.

## Manual QA

1. Sign in as an explicitly allowed admin and open `/admin/users`; verify Users and Lesson Management navigation in both directions.
2. Search by username, display name and email. Verify Previous/Next with more than 20 users and no full-directory browser request.
3. Provision accounts with explicit username/display name and with both omitted. Confirm profile/settings rows and username-only login. Confirm neither privilege is granted unless checked.
4. Deactivate a non-admin account through the confirmation dialog. Confirm password login is rejected, existing learning/research rows remain, and Reactivate restores login.
5. Grant/revoke researcher access and refresh the affected session. Confirm the researcher workspace is view-only and revocation preserves results.
6. Grant a second admin, then revoke the first. Confirm duplicate grants are harmless. With one active admin left, confirm revocation fails clearly.
7. Confirm an admin cannot deactivate itself or another admin until that target's admin access is safely revoked.
8. As a student, researcher-only user, anonymous visitor and banned former admin, call/list/mutation endpoints directly and confirm denial.
9. Check list, provisioning form and all dialogs at 320px, phone, tablet and laptop widths in both themes. Confirm keyboard navigation, focus trapping, Escape/cancel and focus restoration.
10. Recheck ordinary student, manually provisioned and researcher login; lesson authoring; student scoring/progression/streak; and researcher reports.

## Intentionally excluded

No hard-delete, impersonation, password inspection/reset history, progress/score/attempt/assessment/streak editing, analytics tools, research-result mutation, user metadata editor or full audit-log UI. Auth email and the initial provisioning password are the only Auth credentials accepted by the form; existing passwords are never retrievable.
