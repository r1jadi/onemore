-- 0014 — usernames become writable by their own account.
--
-- APPLY ORDER: after 0013. Manual application only (Supabase SQL Editor).
--
--   * Grants UPDATE (username) on public.profiles to authenticated. The
--     existing `profiles_update_self` policy already scopes the row
--     (`auth.uid() = id`, and suspended accounts still cannot write), so no
--     new policy is needed — only the column grant was missing.
--   * Nothing else changes: the format CHECK, the case-insensitive unique
--     index and the SELECT projection stay exactly as they are, so the rules
--     a rename must satisfy are the ones every writer already meets.
--
-- Rollback (manual):
--   revoke update (username) on public.profiles from authenticated;

grant update (username) on public.profiles to authenticated;

-- Verification:
--   select privilege_type from information_schema.role_column_grants
--    where table_name = 'profiles' and grantee = 'authenticated'
--      and column_name = 'username';
