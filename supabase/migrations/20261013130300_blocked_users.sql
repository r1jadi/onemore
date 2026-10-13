-- 0010 — blocked-user relationships.
--
-- APPLY ORDER: after 0009. Manual application only (Supabase SQL Editor).
--
--   * public.blocked_users (blocker_id, blocked_id) — owner-scoped, no self-block.
--   * RLS: blocker reads/writes own rows only. Blocked users cannot read who
--     blocked them through this table.
--   * Enforcement in product surfaces is by filtering blocked ids client-side
--     and server-side where queries support it; this table is the source of truth.
--
-- Rollback (manual):
--   drop table public.blocked_users;

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_no_self check (blocker_id <> blocked_id)
);

create index if not exists blocked_users_blocker_idx on public.blocked_users (blocker_id, created_at desc);
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);

revoke all on public.blocked_users from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, delete on public.blocked_users to authenticated;
grant all on public.blocked_users to service_role;

alter table public.blocked_users enable row level security;

drop policy if exists blocked_users_select_own on public.blocked_users;
create policy blocked_users_select_own
  on public.blocked_users for select to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists blocked_users_insert_own on public.blocked_users;
create policy blocked_users_insert_own
  on public.blocked_users for insert to authenticated
  with check (auth.uid() = blocker_id);

drop policy if exists blocked_users_delete_own on public.blocked_users;
create policy blocked_users_delete_own
  on public.blocked_users for delete to authenticated
  using (auth.uid() = blocker_id);

-- Verification:
--   select * from public.blocked_users limit 1;
--   select policyname, cmd from pg_policies where tablename = 'blocked_users';
