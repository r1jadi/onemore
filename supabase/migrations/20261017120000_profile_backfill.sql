-- 0018 — every auth account has a profile, and the trigger cannot block signup.
--
-- APPLY ORDER: after 0017. Manual application only (Supabase SQL Editor).
--
-- Two inconsistent states are repaired here:
--
--   * an `auth.users` row with no `public.profiles` row. The app reads
--     `profiles.onboarded_at` to tell a new account from a registered one. A
--     missing row was reported as "not onboarded", so an existing Google
--     account was sent back through sign-up and then could not finish — the
--     registration write has a row to update, and there was none. That dead end
--     is also what pushes a returning user toward registering again.
--   * an `auth.users` row with no `public.user_roles` row, which leaves the
--     caller's role to the token claim alone.
--
-- It also recreates `handle_new_user` with two fixes: a generated username can
-- no longer collide with an existing one and block the auth insert that fired
-- the trigger, and a long email local part is trimmed to the 60-character
-- display-name limit instead of failing the insert.
--
-- Idempotent: safe to run twice, and safe on a database with no accounts. It
-- creates no rows for anyone whose profile already exists, and changes no
-- existing profile value.
--
-- Rollback (manual): none. Restoring the previous trigger definition is
-- `supabase/migrations/20261005120000_core_schema.sql`'s `handle_new_user`;
-- the backfilled rows are legitimate and should be kept.

-- ─────────────────────────────────────────────────────────────────────────────
-- The trigger: new accounts always get a profile and a role row
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_name text;
  candidate text;
  suffix integer := 0;
begin
  -- Derived from the immutable account id, so two accounts cannot normally
  -- propose the same name. The loop makes even that case recoverable.
  base_name := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  candidate := base_name;

  while exists (select 1 from public.profiles p where p.username = candidate) loop
    suffix := suffix + 1;
    if suffix > 99 then
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
      exit;
    end if;
    candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10)
      || lpad(suffix::text, 2, '0');
  end loop;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- The repair: accounts that already exist without the rows
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  account record;
  base_name text;
  candidate text;
  suffix integer;
begin
  for account in
    select u.id, u.email
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
  loop
    base_name := 'user_' || substr(replace(account.id::text, '-', ''), 1, 12);
    candidate := base_name;
    suffix := 0;

    while exists (select 1 from public.profiles p where p.username = candidate) loop
      suffix := suffix + 1;
      if suffix > 99 then
        candidate := base_name || '_' || substr(md5(random()::text), 1, 6);
        exit;
      end if;
      candidate := 'user_' || substr(replace(account.id::text, '-', ''), 1, 10)
        || lpad(suffix::text, 2, '0');
    end loop;

    insert into public.profiles (id, username, display_name)
    values (
      account.id,
      candidate,
      left(
        coalesce(nullif(split_part(coalesce(account.email, ''), '@', 1), ''), candidate),
        60
      )
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;

insert into public.user_roles (user_id, role)
select u.id, 'user'
from auth.users u
where not exists (select 1 from public.user_roles r where r.user_id = u.id)
on conflict (user_id) do nothing;

-- Verification:
--   select count(*) from auth.users u
--    where not exists (select 1 from public.profiles p where p.id = u.id);
--   -- must be 0
--   select count(*) from auth.users u
--    where not exists (select 1 from public.user_roles r where r.user_id = u.id);
--   -- must be 0
--
-- The follower/following counts need no new index: `follows` already has the
-- primary key (follower_id, followee_id), whose leading column serves the
-- "following" count, and `follows_followee_idx` serves "followers".
