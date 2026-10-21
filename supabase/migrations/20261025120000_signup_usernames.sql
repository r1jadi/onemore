-- 0028 — the username chosen during sign-up is the one the account keeps.
--
-- APPLY ORDER: after `20261024120100_seven_second_playable.sql`. Manual
-- application only (Supabase SQL Editor).
--
-- Sign-up now collects a username. The web app sends it in the Supabase sign-up
-- request's `data` payload, which GoTrue stores on `auth.users.raw_user_meta_data`
-- before the `on_auth_user_created` trigger fires. This migration teaches
-- `handle_new_user` to read it:
--
--   * a valid chosen username is inserted verbatim (after trimming and
--     lowercasing, the same normalization the API and the form apply). It is
--     never replaced by the generated `user_<id>` form.
--   * a chosen username that is already taken raises the existing unique
--     violation on `profiles_username_key`. The whole auth insert — and this
--     trigger's profile and role rows — rolls back in the same transaction, so a
--     failed sign-up leaves no account behind. The unique index is the
--     concurrency authority: two simultaneous registrations of one name cannot
--     both commit.
--   * metadata with no username (Google OAuth, and clients that predate the
--     field) keeps the generated, collision-safe fallback.
--   * metadata carrying a username that does not satisfy the format is treated
--     as absent rather than persisted. The auth service rejects such a value
--     before GoTrue is called; this branch only protects OAuth/provider metadata
--     from an unusable value it may happen to carry.
--
-- Case-insensitive uniqueness is unchanged: `username` is `citext` and
-- `profiles_username_key` is a unique index over it, so `Rijad`, `rijad` and
-- `RIJAD` all normalize to the single stored spelling `rijad` and cannot become
-- separate accounts.
--
-- Existing profiles are not touched and no bulk rename or backfill runs.
--
-- Rollback (manual): restore the previous definition from
-- `20261017120000_profile_backfill.sql`. Accounts created in the meantime keep
-- their chosen usernames, which remain valid.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  candidate text;
  suffix integer := 0;
begin
  -- The sign-up form's choice, normalized exactly like the API's: trim, then
  -- lowercase. `raw_user_meta_data` is caller-supplied, so it is only ever
  -- inserted after the same format check the database constraint applies.
  requested_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = '' then
    requested_username := null;
  elsif requested_username !~ '^[a-z0-9_]{3,24}$' then
    -- Not a usable username. Treat it as absent rather than failing an OAuth
    -- sign-in whose provider metadata happens to carry a `username` key; the
    -- app's own sign-up path never sends an invalid value.
    requested_username := null;
  end if;

  if requested_username is not null then
    -- The explicit choice wins. A collision on `profiles_username_key` is
    -- deliberately not caught here: it aborts the auth insert, which is what
    -- makes a taken name a refused registration rather than a silent rename.
    candidate := requested_username;
  else
    -- Derived from the immutable account id, so two accounts cannot normally
    -- propose the same name. The loop makes even that case recoverable.
    candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);

    while exists (select 1 from public.profiles p where p.username = candidate) loop
      suffix := suffix + 1;
      if suffix > 99 then
        candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
        exit;
      end if;
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10)
        || lpad(suffix::text, 2, '0');
    end loop;
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    left(
      coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), candidate),
      60
    )
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile and role rows for a new auth user. A username supplied in raw_user_meta_data is honored after trim/lowercase; a taken name fails the insert via profiles_username_key, and only a missing (or invalid) choice falls back to a generated username.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verification:
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure);
--   -- must read raw_user_meta_data ->> 'username'
--
--   select indexdef from pg_indexes
--    where schemaname = 'public' and indexname = 'profiles_username_key';
--   -- must be a UNIQUE index over public.profiles (username), the citext
--   -- column, which is how case-insensitive uniqueness is enforced.
--
--   select count(*) from (
--     select lower(username::text) from public.profiles group by 1 having count(*) > 1
--   ) duplicates;
--   -- must be 0
