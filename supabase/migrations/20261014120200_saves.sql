-- 0013 — saved games.
--
-- APPLY ORDER: after 0012. Manual application only (Supabase SQL Editor).
--
--   * public.saves (user_id, game_id) — one row per player per game. The primary
--     key is the duplicate guard: a second save of the same game conflicts
--     instead of inserting, so concurrent requests cannot create two rows.
--   * Saves are private: no anonymous grant, and every policy is owner-scoped,
--     so a player can only ever read, add or remove their own rows.
--   * Only published games can be saved. Drafts are invisible to other players,
--     and a save pointing at one would leak its existence through the saved
--     list.
--
-- Rollback (manual):
--   drop table public.saves;

create table if not exists public.saves (
  user_id    uuid not null references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create index if not exists saves_user_idx on public.saves (user_id, created_at desc);
create index if not exists saves_game_idx on public.saves (game_id);

revoke all on public.saves from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, delete on public.saves to authenticated;
grant all on public.saves to service_role;

alter table public.saves enable row level security;

drop policy if exists saves_select_own on public.saves;
create policy saves_select_own
  on public.saves for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists saves_insert_own on public.saves;
create policy saves_insert_own
  on public.saves for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'published')
  );

drop policy if exists saves_delete_own on public.saves;
create policy saves_delete_own
  on public.saves for delete to authenticated
  using (auth.uid() = user_id);

-- Verification:
--   select * from public.saves limit 1;
--   select policyname, cmd from pg_policies where tablename = 'saves';
