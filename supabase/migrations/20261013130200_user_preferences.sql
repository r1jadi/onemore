-- 0009 — per-user preferences for privacy, notifications, language and appearance.
--
-- APPLY ORDER: after 0001 (core schema) and 0002 (rls_and_grants). New file,
-- never edit an applied migration. DO NOT PUSH via CLI — apply manually in the
-- Supabase SQL Editor and verify with the queries at the bottom.
--
-- What this adds:
--   * public.user_preferences — one row per user, owned by that user.
--   * Grants + RLS: owner-only read/write, least privilege, RLS enabled.
--   * No server-owned columns: every column here is user-writable by design.
--
-- Rollback (manual, only if this migration has not been depended on):
--   drop trigger if exists ... (none); drop policy ...; drop table public.user_preferences;

create table if not exists public.user_preferences (
  user_id                      uuid primary key references auth.users (id) on delete cascade,
  private_account              boolean not null default false,
  show_on_leaderboards         boolean not null default true,
  show_recently_played         boolean not null default true,
  allow_comments               boolean not null default true,
  allow_mentions               boolean not null default true,
  personalised_recommendations boolean not null default true,
  notify_beats                 boolean not null default true,
  notify_followers             boolean not null default true,
  notify_comments              boolean not null default true,
  language                     text,
  appearance                   text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint user_preferences_language_format check (language is null or language in ('en', 'pl')),
  constraint user_preferences_appearance_format check (appearance is null or appearance in ('dark', 'light', 'system'))
);

create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- Grants: owner-only via Data API; service_role keeps full access.
revoke all on public.user_preferences from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own
  on public.user_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own
  on public.user_preferences for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own
  on public.user_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No delete policy: preferences die with the account (on delete cascade).
-- Verification (run after applying):
--   select * from public.user_preferences limit 1;
--   select policyname, cmd from pg_policies where tablename = 'user_preferences';
