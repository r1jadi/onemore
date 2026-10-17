-- 0019 — accounts that existed before the sign-up completion flow are registered.
--
-- APPLY ORDER: after 0018. Manual application only (Supabase SQL Editor).
--
-- `public.profiles.onboarded_at` is the app's registration marker: the auth
-- service reports it as `session.onboarded`, and `false` sends the visitor
-- through the sign-up completion steps while `true` (or absent) lets the
-- account straight in. Nothing wrote the marker before the completion flow
-- shipped — commit 5a3ef5e, 2026-10-17 19:11:09 +02:00 — and the old flow
-- treated account creation itself as the end of sign-up: `signUp`/`signIn` was
-- followed by a session and the feed. Every account that already existed was
-- therefore still `onboarded_at is null`, indistinguishable to the app from a
-- brand-new Google account that has one more sign-up step to finish. A
-- returning user with an existing account was sent back through "Create your
-- account" instead of being recognized — and completing that screen again is
-- exactly the duplicate-registration path the app must not offer.
--
-- This migration backfills the marker once, for accounts that already existed
-- when the completion flow was introduced: their sign-up *was* complete, under
-- the product they signed up for. Accounts created after that instant keep the
-- marker's meaning — `null` until the flow finishes.
--
-- The account's creation instant is read from `auth.users.created_at` (when
-- GoTrue created the identity), never from `profiles.created_at`: 0018 inserted
-- repaired profile rows with the then-current timestamp, which says when the
-- row was repaired, not when the account was made. Accounts the trigger has
-- served since 0018 already carry the correct `created_at` and are not
-- affected either way.
--
-- Idempotent: only rows whose marker is still null are touched; safe to re-run
-- and safe on a database with accounts or without.

update public.profiles p
set onboarded_at = u.created_at
from auth.users u
where u.id = p.id
  and p.onboarded_at is null
  and u.created_at < timestamptz '2026-10-17 17:11:09+00';

-- Verification:
--   select count(*) from public.profiles p
--     join auth.users u on u.id = p.id
--    where p.onboarded_at is null
--      and u.created_at < timestamptz '2026-10-17 17:11:09+00';
--   -- must be 0
--   select count(*) from public.profiles p
--     join auth.users u on u.id = p.id
--    where p.onboarded_at is not null
--      and u.created_at >= timestamptz '2026-10-17 17:11:09+00';
--   -- must be 0 unless the account finished onboarding after the flow shipped
--
-- Rollback (break-glass, manual): `update public.profiles set onboarded_at =
-- null where onboarded_at = created_at;` restores the pre-migration state only
-- for trigger-created rows; repaired rows (0018) have a different
-- `created_at`. Prefer fixing forward over running this.
