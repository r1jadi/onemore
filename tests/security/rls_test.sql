-- RLS and authorization test suite.
--
-- Run against a throwaway database only:
--   ./scripts/test-rls.sh        (starts an ephemeral Postgres via Docker)
-- The whole file runs in one transaction and rolls back, so it leaves no data.
--
-- Every assertion is written as either
--   allow(...)   — the statement must succeed
--   denied(...)  — the statement must be rejected (privilege or RLS violation)
--   blocked(...) — the statement must silently affect zero rows (RLS filtered)
--   visible(...) — the statement must return the expected row count
--
-- Supabase's hosted project also has `supabase_admin`; its absence is what
-- makes this file safe: it refuses to run where that role exists.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run: this suite is for a throwaway database, not a hosted project';
  end if;
end $$;

\set ON_ERROR_STOP on

create schema if not exists rls_test;
grant usage on schema rls_test to anon, authenticated, service_role;

create or replace function rls_test.ok(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
  raise notice 'ok   %', message;
end $$;

-- The statement must be rejected.
create or replace function rls_test.denied(statement text, message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception
    when insufficient_privilege then
      raise notice 'ok   % (denied)', message;
      return;
    when others then
      raise exception 'ASSERTION FAILED: % — unexpected error: % (%)', message, sqlerrm, sqlstate;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- The statement must be rejected by a constraint (integrity rule) rather than
-- by a policy. Used for the invariants the user can reach.
create or replace function rls_test.rejected(statement text, message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception
    when check_violation or unique_violation or foreign_key_violation or not_null_violation then
      raise notice 'ok   % (constraint)', message;
      return;
    when insufficient_privilege then
      raise exception 'ASSERTION FAILED: % — blocked by a policy, expected a constraint', message;
    when others then
      raise exception 'ASSERTION FAILED: % — unexpected error: % (%)', message, sqlerrm, sqlstate;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- The statement must be rejected with a specific SQLSTATE. Used for the
-- server-side write functions, whose invalid input is an exception rather than a
-- policy violation, and whose refusals are outcomes the caller reads.
create or replace function rls_test.raises(statement text, expected_state text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  begin
    execute statement;
  exception
    when others then
      actual := sqlstate;
      if actual = expected_state then
        raise notice 'ok   % (raised %)', message, actual;
        return;
      end if;
      raise exception 'ASSERTION FAILED: % — raised %, expected %', message, actual, expected_state;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- A server-side function that answers with an outcome rather than raising: the
-- call is made exactly once, because every call has side effects.
create or replace function rls_test.says(statement text, expected text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  execute format('select (%s).outcome', statement) into actual;
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % — outcome was %, expected %', message, coalesce(actual, 'null'), expected;
  end if;
  raise notice 'ok   % (outcome %)', message, actual;
end $$;

-- One field of that same answer, read from a single call.
create or replace function rls_test.says_field(statement text, field text, expected text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  execute format('select (%s).%s::text', statement, field) into actual;
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % — % was %, expected %', message, field, coalesce(actual, 'null'), expected;
  end if;
  raise notice 'ok   % (% = %)', message, field, actual;
end $$;

-- The statement must succeed while touching no rows.
create or replace function rls_test.blocked(statement text, message text)
returns void language plpgsql as $$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'ASSERTION FAILED: % — % rows were affected, expected 0', message, affected;
  end if;
  raise notice 'ok   % (0 rows)', message;
end $$;

-- The statement must succeed and affect at least one row.
create or replace function rls_test.allow(statement text, message text)
returns void language plpgsql as $$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'ASSERTION FAILED: % — the statement affected no rows', message;
  end if;
  raise notice 'ok   % (allowed)', message;
end $$;

-- The statement must succeed and return exactly one non-null uuid, which the
-- caller compares against the expected value.
create or replace function rls_test.allow_uuid(statement text, message text)
returns uuid language plpgsql as $$
declare
  value uuid;
begin
  execute statement into value;
  if value is null then
    raise exception 'ASSERTION FAILED: % — the statement returned NULL', message;
  end if;
  raise notice 'ok   % (allowed)', message;
  return value;
end $$;

create or replace function rls_test.count_rows(statement text)
returns bigint language plpgsql as $$
declare
  total bigint;
begin
  execute 'select count(*) from (' || statement || ') as t' into total;
  return total;
end $$;

create or replace function rls_test.visible(statement text, expected bigint, message text)
returns void language plpgsql as $$
declare
  actual bigint;
begin
  actual := rls_test.count_rows(statement);
  if actual <> expected then
    raise exception 'ASSERTION FAILED: % — saw % rows, expected %', message, actual, expected;
  end if;
  raise notice 'ok   % (% rows)', message, actual;
end $$;

grant execute on all functions in schema rls_test to anon, authenticated, service_role;

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixtures (created as the superuser, then rolled back at the end)
-- ─────────────────────────────────────────────────────────────────────────────

\set alice '11111111-1111-4111-8111-111111111111'
\set bob   '22222222-2222-4222-8222-222222222222'
\set carol '33333333-3333-4333-8333-333333333333'
\set dave  '44444444-4444-4444-8444-444444444444'
\set erin  '55555555-5555-4555-8555-555555555555'

insert into auth.users (id, email) values
  (:'alice', 'alice@example.com'),
  (:'bob',   'bob@example.com'),
  (:'carol', 'carol@example.com'),
  (:'dave',  'dave@example.com'),
  (:'erin',  'erin@example.com');

-- The auth trigger must have created a profile and a role row for each user.
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.profiles where id = '11111111-1111-4111-8111-111111111111'$$) = 1,
  'new auth users get a profile automatically'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.user_roles where user_id = '11111111-1111-4111-8111-111111111111' and role = 'user'$$) = 1,
  'new auth users get the least-privileged role'
);

-- Roles are granted out of band (service_role today, a dashboard action later).
update public.user_roles set role = 'moderator' where user_id = :'carol';
update public.user_roles set role = 'admin' where user_id = :'dave';
update public.profiles set is_suspended = true where id = :'erin';

-- The seed already created the reference categories; keep the fixture
-- idempotent so this file works with and without seed.sql applied.
insert into public.categories (slug, name) values ('puzzle', 'Puzzle')
on conflict (slug) do nothing;
insert into public.categories (slug, name) values ('arcade', 'Arcade')
on conflict (slug) do nothing;

\set published_game 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
\set draft_game     'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'
\set bob_game       'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'

-- The slugs are prefixed `fixture-` on purpose. The catalogue migration ships
-- the real first-party games (including `stack-10`), and the unique index on
-- `slug` would reject a fixture that reused one of them.
--
-- The categories are load-bearing for the count assertions further down:
-- `puzzle` holds a published fixture and `word` holds only a draft, so a real
-- published-game count must be non-zero for one and exactly zero for the other.
insert into public.games (id, owner_id, slug, title, status, published_at, category_id) values
  (:'published_game', :'alice', 'fixture-stack', 'Fixture Stack', 'published', now(),
   (select id from public.categories where slug = 'puzzle')),
  (:'draft_game',     :'alice', 'fixture-draft', 'Fixture Draft', 'draft', null,
   (select id from public.categories where slug = 'word')),
  (:'bob_game',       :'bob',   'fixture-bob',   'Fixture Bob',   'published', now(),
   (select id from public.categories where slug = 'arcade'));

-- Integrity rules added with the catalogue. These are asserted here, outside any
-- role switch, because they must hold for every writer including the database
-- owner — a policy can only constrain the roles it names.
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, playable) values ('11111111-1111-4111-8111-111111111111', 'fixture-playable', 'Claimed Playable', true)$$,
  'a game cannot be playable without a runtime'
);
select rls_test.rejected(
  $$insert into public.games (slug, title, status) values ('fixture-orphan', 'Orphan', 'published')$$,
  'a game is either owned by an account or explicitly first-party'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, runtime) values ('11111111-1111-4111-8111-111111111111', 'fixture-runtime', 'Runtime', 'Not A Runtime')$$,
  'a runtime identifier must look like a slug'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, cover_path) values ('11111111-1111-4111-8111-111111111111', 'fixture-cover', 'Cover', 'no-folder-here')$$,
  'a cover path must live under a folder'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, instructions) values ('11111111-1111-4111-8111-111111111111', 'fixture-instructions', 'Instructions', '')$$,
  'instructions are either written or absent, never empty'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where is_official and owner_id is not null$$) = 0,
  'a first-party game carries no account as its owner'
);

\set alice_comment 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
\set hidden_comment 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
\set bob_comment   'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'

insert into public.comments (id, game_id, author_id, body, is_hidden) values
  (:'alice_comment', :'published_game', :'alice', 'Nice one', false),
  (:'hidden_comment', :'published_game', :'alice', 'Removed by a moderator', true),
  (:'bob_comment',   :'published_game', :'bob',   'Agreed', false);

insert into public.notifications (user_id, kind, payload) values
  (:'alice', 'system', '{"message":"welcome"}'),
  (:'bob',   'system', '{"message":"welcome"}');

insert into public.reports (reporter_id, target_kind, target_id, reason)
values (:'alice', 'comment', :'bob_comment', 'spam');

insert into public.likes (user_id, target_kind, target_id)
values (:'bob', 'game', :'published_game');

insert into public.saves (user_id, game_id)
values (:'bob', :'published_game');

insert into public.game_sessions (game_id, user_id) values (:'published_game', :'alice');

-- ─────────────────────────────────────────────────────────────────────────────
-- Anonymous callers
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- Absolute row counts are deliberately not asserted for the whole table: the
-- catalogue migration ships the real first-party games, so how many rows exist
-- is content, not a rule. The rule is asserted directly — one global statement
-- that must hold whatever the catalogue holds, plus per-fixture visibility.
select rls_test.visible($$select id from public.games where status <> 'published'$$, 0,
  'no unpublished game is visible to an anonymous caller');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$, 1,
  'anon sees a published game');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$, 1,
  'anon sees another creator''s published game');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$, 0, 'anon cannot see a draft');
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where slug = 'stack-10'$$) = 1,
  'the real first-party catalogue is readable by an anonymous caller'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where playable and runtime is null$$) = 0,
  'nothing is presented as playable without a runtime'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.categories$$) >= 2,
  'anon reads reference data'
);

-- Real published-game counts, as the categories endpoint reads them.
select rls_test.ok(
  (select game_count from public.category_game_counts where slug = 'puzzle') >= 1,
  'a category with a published game reports a non-zero count'
);
select rls_test.ok(
  (select game_count from public.category_game_counts where slug = 'word') = 0,
  'a category whose only game is a draft reports zero'
);
select rls_test.ok(
  (select count(*) from public.category_game_counts) = (select count(*) from public.categories),
  'every category is counted, including the empty ones'
);

select rls_test.denied($$insert into public.games (owner_id, slug, title) values ('11111111-1111-4111-8111-111111111111', 'x-game', 'X')$$,
  'anon cannot create games');
select rls_test.denied($$select id from public.analytics_events$$,
  'anon cannot read analytics events');
select rls_test.denied($$select id from public.notifications$$,
  'anon cannot read notifications');
select rls_test.denied($$select user_id from public.user_roles$$,
  'anon cannot read the role table');
select rls_test.visible($$select id from public.comments where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$, 0,
  'a hidden comment is invisible to anonymous callers');
select rls_test.visible($$select id from public.profiles$$, 5, 'public profile fields are readable');
select rls_test.denied($$select is_suspended from public.profiles$$,
  'the suspension flag is not readable through the Data API');
select rls_test.denied($$update public.profiles set display_name = 'anon' where id = '11111111-1111-4111-8111-111111111111'$$,
  'anon cannot write profiles');
select rls_test.denied($$select * from public.saves$$,
  'saved games are not readable by anonymous callers at all');

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Signed-in user: Alice
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(auth.uid() = :'alice'::uuid, 'auth.uid() resolves from the verified claims');

-- Visibility. Scoped to the fixture ids for the same reason as above.
select rls_test.visible($$select id from public.games where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')$$, 3, 'a creator sees published games plus own drafts');
select rls_test.visible($$select id from public.game_sessions$$, 1, 'a player sees own sessions');
select rls_test.visible($$select id from public.notifications$$, 1, 'a player sees only own notifications');
select rls_test.visible($$select user_id from public.user_roles$$, 1, 'a player sees only own role row');
select rls_test.visible($$select id from public.comments$$, 3, 'a hidden comment stays visible to its author');
select rls_test.visible($$select id from public.comments where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$, 1,
  'the author sees their own hidden comment by id');
select rls_test.visible($$select id from public.profiles$$, 5, 'profiles are readable (public profile fields)');

-- Own profile writes are allowed, privileged columns are not
select rls_test.ok(
  (select count(*) from public.profiles where id = :'alice') = 1,
  'a player can read own profile row'
);
select rls_test.denied(
  $$update public.profiles set is_suspended = false where id = '55555555-5555-4555-8555-555555555555'$$,
  'a player cannot clear another account''s suspension'
);
-- Usernames are writable by their own account only. The format CHECK and the
-- case-insensitive unique index stay the authority behind the API's validation:
-- 'BOB' never reaches the index because the format check rejects uppercase
-- first, so case-insensitivity needs no separate assertion here.
select rls_test.allow(
  $$update public.profiles set username = 'alice_renamed' where id = '11111111-1111-4111-8111-111111111111'$$,
  'a player can rename their own account'
);
select rls_test.ok(
  (select username = 'alice_renamed' from public.profiles where id = :'alice'),
  'the renamed username is what the row holds'
);
select rls_test.rejected(
  $$update public.profiles set username = (select username from public.profiles where id = '22222222-2222-4222-8222-222222222222') where id = '11111111-1111-4111-8111-111111111111'$$,
  'a username someone else holds is rejected, so concurrent renames cannot collide'
);
select rls_test.blocked(
  $$update public.profiles set username = 'alice_writes_bob' where id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot rename another account'
);
select rls_test.rejected(
  $$update public.profiles set username = 'No Capitals' where id = '11111111-1111-4111-8111-111111111111'$$,
  'a username outside the format is rejected'
);

-- Escalation attempts
select rls_test.denied(
  $$insert into public.user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin')$$,
  'a player cannot grant themselves a role'
);
select rls_test.denied(
  $$update public.user_roles set role = 'admin' where user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a player cannot promote themselves'
);
select rls_test.denied(
  $$insert into public.scores (session_id, game_id, user_id, score) values (gen_random_uuid(), 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 999999)$$,
  'a player cannot write a score directly'
);
select rls_test.denied(
  $$update public.games set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'game ownership is immutable'
);

-- Publishing is a moderation decision
select rls_test.denied(
  $$update public.games set status = 'published' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator cannot publish their own game'
);
select rls_test.allow(
  $$update public.games set title = 'Draft Game v2' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator can edit an own draft'
);
select rls_test.blocked(
  $$update public.games set title = 'Hijacked' where id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$,
  'a creator cannot edit someone else''s game'
);
select rls_test.blocked(
  $$delete from public.games where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'a published game cannot be deleted by its owner'
);

-- Comments
select rls_test.blocked(
  $$update public.comments set body = 'edited' where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'a player cannot edit another author''s comment'
);
select rls_test.denied(
  $$update public.comments set is_hidden = false where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$,
  'a player cannot unhide a moderated comment'
);
select rls_test.denied(
  $$insert into public.comments (game_id, author_id, body) values ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'spam on a draft')$$,
  'comments are only accepted on published games'
);
select rls_test.denied(
  $$insert into public.comments (game_id, author_id, body) values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'not mine')$$,
  'a player cannot post as another user'
);

-- Social writes are always attributed to the verified caller
select rls_test.allow(
  $$insert into public.likes (user_id, target_kind, target_id)
    values ('11111111-1111-4111-8111-111111111111', 'game', 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')$$,
  'a player can like a game as themselves'
);
select rls_test.denied(
  $$insert into public.likes (user_id, target_kind, target_id) values ('22222222-2222-4222-8222-222222222222', 'game', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player cannot like as another user'
);
select rls_test.blocked(
  $$delete from public.likes where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot remove another player''s like'
);
select rls_test.allow(
  $$delete from public.likes
    where user_id = '11111111-1111-4111-8111-111111111111'
      and target_kind = 'game'
      and target_id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$,
  'a player can remove their own like'
);

-- Saved games are private rows: only the owner reads, adds or removes them,
-- only for published games, and a second save conflicts instead of duplicating.
select rls_test.allow(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player can save a published game as themselves'
);
select rls_test.rejected(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'saving the same game twice is rejected, so concurrent saves cannot duplicate'
);
select rls_test.denied(
  $$insert into public.saves (user_id, game_id)
    values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player cannot save as another user'
);
select rls_test.denied(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa')$$,
  'a draft game cannot be saved'
);
select rls_test.blocked(
  $$delete from public.saves where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot remove another player''s save'
);
select rls_test.allow(
  $$delete from public.saves
    where user_id = '11111111-1111-4111-8111-111111111111'
      and game_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'a player can remove their own save'
);
select rls_test.visible($$select * from public.saves$$, 0,
  'a player sees only their own saves');

-- Comments follow the same attribution rule, with author-or-staff deletion.
select rls_test.blocked(
  $$delete from public.comments where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'a player cannot delete another author''s comment'
);
select rls_test.rejected(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$$,
  'self-following is rejected'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title) values ('11111111-1111-4111-8111-111111111111', 'Stack 10', 'Bad Slug')$$,
  'invalid game slugs are rejected before they reach the catalogue'
);
select rls_test.allow(
  $$update public.games set instructions = 'Tap a column to drop a tile.' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator can write instructions on an own draft'
);

-- First-party content is not something a user can mint, and the badge is not a
-- field any client may flip.
select rls_test.denied(
  $$insert into public.games (owner_id, slug, title, is_official) values ('11111111-1111-4111-8111-111111111111', 'fixture-official', 'Fake Official', true)$$,
  'a creator cannot mint first-party content'
);
select rls_test.denied(
  $$update public.games set is_official = true where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'the first-party flag is not writable through the Data API'
);

-- Sessions
select rls_test.visible(
  $$select id from public.game_sessions where user_id = '22222222-2222-4222-8222-222222222222'$$,
  0,
  'another player''s sessions are invisible'
);
select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222')$$,
  'a player cannot open a session for someone else'
);

-- Reports
select rls_test.visible($$select id from public.reports$$, 1, 'a reporter sees own reports');
select rls_test.blocked(
  $$update public.reports set status = 'dismissed' where reporter_id = '11111111-1111-4111-8111-111111111111'$$,
  'a reporter cannot resolve their own report'
);
select rls_test.blocked(
  $$update public.notifications set read_at = now() where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'notifications belonging to another user cannot be updated'
);
select rls_test.allow(
  $$update public.notifications set read_at = now() where user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a player can mark their own notifications read'
);

-- Storage
select rls_test.denied(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', '22222222-2222-4222-8222-222222222222/steal.png', '11111111-1111-4111-8111-111111111111')$$,
  'a player cannot upload into another user''s folder'
);
select rls_test.allow(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('avatars', '11111111-1111-4111-8111-111111111111/me.png', '11111111-1111-4111-8111-111111111111')$$,
  'a player can upload into their own folder'
);
select rls_test.visible($$select id from storage.objects where bucket_id = 'game-builds'$$, 0,
  'private build objects are invisible to other users');

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Suspended user
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'erin', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.denied(
  $$update public.profiles set display_name = 'still here' where id = '55555555-5555-4555-8555-555555555555'$$,
  'a suspended account cannot update its profile'
);
select rls_test.denied(
  $$update public.profiles set username = 'erin_returns' where id = '55555555-5555-4555-8555-555555555555'$$,
  'a suspended account cannot rename itself either'
);
select rls_test.visible(
  $$select id from public.profiles where id = '55555555-5555-4555-8555-555555555555'$$,
  1,
  'a suspended account can still read its own profile'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Moderator and administrator
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'carol', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(public.is_staff(), 'a moderator is staff');
select rls_test.ok(not public.is_admin(), 'a moderator is not an administrator');
select rls_test.ok(
  (public.admin_identity() ->> 'isStaff') = 'true'
    and (public.admin_identity() ->> 'isAdmin') = 'false',
  'a moderator reads staff status from the database rather than from a claim'
);
select rls_test.visible($$select id from public.reports$$, 1, 'a moderator sees the report queue');
select rls_test.visible($$select id from public.comments$$, 3, 'a moderator sees hidden comments');
select rls_test.allow(
  $$update public.reports set status = 'reviewing'$$,
  'a moderator can triage a report'
);
select rls_test.ok(
  (select resolved_by is null from public.reports limit 1),
  'triaging does not stamp a resolver'
);
select rls_test.ok(
  rls_test.allow_uuid(
    $$update public.reports set status = 'resolved' returning resolved_by$$,
    'a moderator can resolve a report'
  ) = '33333333-3333-4333-8333-333333333333'::uuid,
  'resolving stamps the caller as the resolver, not a client-supplied value'
);
select rls_test.allow(
  $$update public.games set status = 'published' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a moderator can publish a game'
);
select rls_test.denied(
  $$update public.games set is_official = true where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'even staff cannot flip the first-party flag through the Data API'
);
select rls_test.ok(
  (select published_at is not null from public.games where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'),
  'publishing stamps published_at in the database'
);
select rls_test.denied(
  $$insert into public.user_roles (user_id, role) values ('22222222-2222-4222-8222-222222222222', 'admin')$$,
  'a moderator cannot grant roles'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'dave', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(public.is_admin(), 'an administrator is an administrator');
select rls_test.ok(public.is_staff(), 'an administrator is also staff');
select rls_test.ok(
  (public.admin_identity() ->> 'isAdmin') = 'true',
  'an administrator reads the administrator role from the database'
);
select rls_test.denied(
  $$update public.profiles set is_suspended = true where id = '22222222-2222-4222-8222-222222222222'$$,
  'suspension is not writable through the Data API, even for an administrator'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin operations (the staff-gated definer functions)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These run as the definer and therefore bypass RLS, so the role check inside
-- each one is the only control. What matters here is the *denied* direction:
-- a signed-in stranger must not be able to read the directory, the queue or the
-- aggregates, and must not be able to moderate anything.
--
-- `denied(...)` is for the refusals the guard raises (a missing privilege and a
-- guard both answer 42501, so a stranger cannot tell a closed table from a
-- forbidden function). `raises(...)` is for the validation refusals, which are
-- the caller's own mistake and carry their own SQLSTATE.

-- Two rows with known ids, so the write assertions below can name them. A
-- report is created by the owner rather than by a service, exactly as a real
-- report would be before staff ever see it, and the draft game exists only so a
-- staff read can be shown returning a row no other role can see.
\set admin_report 'dddddddd-1111-4111-8111-dddddddddddd'
\set admin_draft  'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa'
insert into public.reports (id, reporter_id, target_kind, target_id, reason)
values (:'admin_report', :'bob', 'comment', :'bob_comment', 'admin suite fixture');
insert into public.games (id, owner_id, slug, title, status)
values (:'admin_draft', :'bob', 'fixture-admin-only', 'Fixture Admin Only', 'draft');

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select rls_test.denied(
  $$select public.admin_identity()$$,
  'an anonymous caller has no identity row to read'
);
select rls_test.denied(
  $$select public.admin_overview()$$,
  'an anonymous caller cannot read the admin overview'
);
select rls_test.denied(
  $$select * from public.admin_user_directory()$$,
  'an anonymous caller cannot read the account directory'
);
select rls_test.denied(
  $$select * from public.admin_report_directory()$$,
  'an anonymous caller cannot read the moderation queue'
);
select rls_test.denied(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'an anonymous caller cannot hide a comment'
);

reset role;

-- An ordinary signed-in player is refused by the guard inside each function,
-- which raises the same SQLSTATE a missing grant does.
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(
  (public.admin_identity() ->> 'role') = 'user'
    and (public.admin_identity() ->> 'isStaff') = 'false'
    and (public.admin_identity() ->> 'userId') = '11111111-1111-4111-8111-111111111111'
    -- The username in the answer is the caller's own profile, not a name from
    -- anywhere else: it is read with `auth.uid()`, never with a parameter.
    and (public.admin_identity() ->> 'username')
        = (select username::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'a player reads their own role and identity from the database, and is not staff'
);
select rls_test.denied($$select public.admin_overview()$$,
  'a player cannot read the admin overview');
select rls_test.denied($$select public.admin_analytics()$$,
  'a player cannot read platform analytics');
select rls_test.denied($$select * from public.admin_user_directory()$$,
  'a player cannot read the account directory');
select rls_test.denied($$select * from public.admin_game_directory()$$,
  'a player cannot list every game, published or not');
select rls_test.visible(
  $$select id from public.games where slug = 'fixture-admin-only'$$,
  0,
  'an unpublished game another account owns is invisible to a player'
);
select rls_test.denied($$select * from public.admin_report_directory()$$,
  'a player cannot read the moderation queue');
select rls_test.denied($$select * from public.admin_comment_directory()$$,
  'a player cannot read the comment moderation list');
select rls_test.denied($$select * from public.admin_score_directory()$$,
  'a player cannot read every verified score');
select rls_test.denied($$select * from public.admin_moderation_log()$$,
  'a player cannot read the audit trail');
select rls_test.denied(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'x')$$,
  'a player cannot archive a game'
);
select rls_test.denied(
  $$select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', 'x')$$,
  'a player cannot dismiss a report'
);
select rls_test.denied(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'a player cannot hide a comment'
);
select rls_test.denied(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'x')$$,
  'a player cannot suspend another account'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'carol', 'role', 'authenticated')::text, true);
set local role authenticated;

-- A moderator may read the directory, and through it the restricted columns the
-- Data API deliberately withholds.
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_user_directory()
    where id = '55555555-5555-4555-8555-555555555555'
      and is_suspended and email = 'erin@example.com'$$) = 1,
  'a moderator can see a suspended account''s email and suspension state through the directory'
);
select rls_test.denied(
  $$select is_suspended from public.profiles limit 1$$,
  'the same column is still unreachable directly through the Data API'
);
select rls_test.ok(
  (public.admin_overview() ->> 'totalUsers')::bigint >= 5,
  'the overview counts the real profile rows and requires staff'
);
select rls_test.ok(
  (public.admin_overview() ->> 'series') is not null
    and jsonb_array_length(public.admin_overview() -> 'series') = 14,
  'the overview series is fourteen real days, not a fabricated projection'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_game_directory()
    where slug = 'fixture-admin-only' and status = 'draft'$$) = 1,
  'the game directory includes a draft that no other role can see'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_game_directory()
    where slug = 'fixture-stack' and plays = 0 and players = 0$$) = 1,
  'the game directory counts completed runs only: an unfinished session is not a play'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_report_directory()
    where reporter_username is not null$$) >= 1,
  'the report queue resolves its reporter through a join the Data API cannot do'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_comment_directory()
    where is_hidden$$) >= 1,
  'the comment list carries hidden comments, which staff alone may see'
);

-- Moderation writes: the decision and its audit land together, and the audit
-- names the caller from the token. Each call happens once (`says_field` reads one
-- field of one call) because every one of them has a side effect.
select rls_test.ok(
  (select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'Retired fixture')
     ->> 'status') = 'archived',
  'a moderator can archive a published game'
);
select rls_test.ok(
  (select status = 'archived' and published_at is null from public.games
     where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  'archiving clears the publication timestamp in the database'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'archive_game' and moderator_id = '33333333-3333-4333-8333-333333333333'$$) = 1,
  'the archive is recorded against the moderator who made the decision'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'draft', 'Back to draft')$$,
  '22023',
  'staff cannot move a game back to draft — that is the creator''s own state'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'Again')$$,
  '22023',
  'a game already in that status is refused rather than silently rewritten'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'rejected', null)$$,
  '22023',
  'rejecting a game without a reason is refused'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-999999999999', 'published', null)$$,
  'P0002',
  'moderating a game that does not exist is refused, not ignored'
);
select rls_test.ok(
  (select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'published', null)
     ->> 'status') = 'published',
  'republishing an archived game restores it'
);
select rls_test.ok(
  (select status = 'published' and published_at is not null from public.games
     where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  'republishing re-stamps published_at from the database clock'
);

select rls_test.raises(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, null)$$,
  '22023',
  'hiding a comment without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'Abuse')
     ->> 'hidden') = 'true',
  'a moderator can hide a comment through the function, not the Data API'
);
select rls_test.ok(
  (select is_hidden from public.comments where id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'),
  'the hidden comment is hidden in the table, not only in the answer'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'hide_comment' and moderator_id = '33333333-3333-4333-8333-333333333333'$$) = 1,
  'hiding a comment records who hid it'
);
select rls_test.ok(
  (select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', false, null)
     ->> 'hidden') = 'false',
  'and restore it without a reason'
);
select rls_test.raises(
  $$select public.admin_set_comment_hidden('99999999-9999-4999-8999-999999999999', true, 'Nope')$$,
  'P0002',
  'hiding a comment that does not exist is refused'
);

-- Reopening a report has to clear the resolution, or the table's own constraint
-- would refuse the change.
select rls_test.raises(
  $$select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', null)$$,
  '22023',
  'dismissing a report without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', 'Not a real report')
     ->> 'status') = 'dismissed',
  'a moderator can dismiss a report'
);
select rls_test.ok(
  (select resolved_by = '33333333-3333-4333-8333-333333333333'::uuid and resolved_at is not null
     from public.reports where id = 'dddddddd-1111-4111-8111-dddddddddddd'),
  'the resolver is stamped from the token, not from the request'
);
select rls_test.ok(
  (select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'reviewing', 'Reopened')
     ->> 'status') = 'reviewing',
  'a moderator can reopen a report'
);
select rls_test.ok(
  (select resolved_by is null and resolved_at is null from public.reports
     where id = 'dddddddd-1111-4111-8111-dddddddddddd'),
  'reopening clears the recorded resolution'
);
select rls_test.denied(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'Abuse')$$,
  'a moderator cannot suspend an account — that is an administrator decision'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'dave', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.raises(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, null)$$,
  '22023',
  'suspending an account without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'Abusive comments')
     ->> 'suspended') = 'true',
  'an administrator can suspend an account through the function'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.admin_user_directory()
    where id = '22222222-2222-4222-8222-222222222222' and is_suspended$$) = 1,
  'the suspension is written to the column the Data API cannot read or update'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'suspend_account' and moderator_id = '44444444-4444-4444-8444-444444444444'$$) = 1,
  'the suspension is recorded against the administrator who made it'
);
select rls_test.raises(
  $$select public.admin_set_suspension('44444444-4444-4444-8444-444444444444', true, 'Locking myself out')$$,
  '22023',
  'an administrator cannot suspend their own account'
);
select rls_test.raises(
  $$select public.admin_set_suspension('99999999-9999-4999-8999-999999999999', true, 'No such account')$$,
  'P0002',
  'suspending an account that does not exist is refused'
);
select rls_test.ok(
  (select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', false, null)
     ->> 'suspended') = 'false',
  'an administrator can restore an account'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.admin_user_directory()
    where id = '22222222-2222-4222-8222-222222222222' and not is_suspended$$) = 1,
  'the restored account reads as restored through the same directory'
);
select rls_test.visible(
  $$select * from public.admin_moderation_log() where action = 'suspend_account'$$,
  1,
  'the audit trail lists the decision that was just made'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Service role (server-side only: the key never reaches a browser)
-- ─────────────────────────────────────────────────────────────────────────────

set local role service_role;

select rls_test.allow(
  $$insert into public.scores (session_id, game_id, user_id, score)
    select id, game_id, user_id, 4200 from public.game_sessions limit 1$$,
  'the service role can write scores'
);
select rls_test.allow(
  $$update public.user_roles set role = 'moderator' where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'the service role can grant roles'
);
select rls_test.allow(
  $$update public.comments set is_hidden = true where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'the service role can hide a comment'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Play sessions and server-verified scores
--
-- Two properties are asserted here, and they are the whole point of the
-- migration: a client cannot write a session or a score at all, and the number
-- that ends up in `scores` is the database's replay rather than the caller's
-- claim. The expected score (55 over 14 tiles and 3 clears) is arithmetic from
-- seed 1, not a value read back from the function.
-- ─────────────────────────────────────────────────────────────────────────────

\set greedy_run 'array[0,0,1,0,0,0,2,2,2,3,0,0,0,0]'
-- Seed 1's Chain line: symbols 0,0,2,3,0,0,2,2,0,1 dealt into ten rounds, 55
-- taps, ten clears, 55 points. See the Chain section of docs/games/README.md.
\set chain_perfect 'array[0,0,0,0,0,2,0,0,2,3,0,0,2,3,0,0,0,2,3,0,0,0,0,2,3,0,0,2,0,0,2,3,0,0,2,2,0,0,2,3,0,0,2,2,0,0,0,2,3,0,0,2,2,0,1]'

-- A published, playable game — the only kind a run can be started for — plus one
-- that stays unpublished, so the refusal path has a subject. The sessions below
-- are fixtures only in the sense that the *superuser* may choose their seed:
-- `start_game_session` never may, which is exactly what makes the expected score
-- below arithmetic instead of whatever the verifier happens to return.
--
-- seed 1: tiles 1,7,9,2,2,5,4,6,7,8,3,4,3,5
--   greedy line 0,0,1,0,0,0,2,2,2,3,0,0,0,0 → 3 clears (3 tiles, 2 tiles, 3
--   tiles) = 20 + 15 + 20 = 55, then the 14th tile overflows column 0.
\set runnable_game 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
\set secret_game   'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
\set chain_game    'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa'
\set pending_session   'cccccccc-1111-4111-8111-cccccccccccc'
\set expired_session   'cccccccc-2222-4222-8222-cccccccccccc'
\set abandoned_session 'cccccccc-3333-4333-8333-cccccccccccc'
\set guest_session     'cccccccc-4444-4444-8444-cccccccccccc'
\set old_rules_session 'cccccccc-5555-4555-8555-cccccccccccc'
\set bob_session       'cccccccc-6666-4666-8666-cccccccccccc'
\set chain_session       'dddddddd-1111-4111-8111-dddddddddddd'
\set chain_loss_session  'dddddddd-2222-4222-8222-dddddddddddd'
\set chain_guest_session 'dddddddd-4444-4444-8444-dddddddddddd'
\set chain_old_session   'dddddddd-5555-4555-8555-dddddddddddd'

insert into public.games (id, owner_id, slug, title, status, published_at, runtime, playable, category_id) values
  (:'runnable_game', :'alice', 'fixture-runnable', 'Fixture Runnable', 'published', now(), 'stack-10', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'secret_game',   :'alice', 'fixture-secret',   'Fixture Secret',   'draft',     null, 'stack-10', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'chain_game',    :'alice', 'fixture-chain',    'Fixture Chain',    'published', now(), 'chain', true,
   (select id from public.categories where slug = 'reaction'));

-- Runs that have been open for five minutes, which is what makes a claimed
-- 45-second duration credible: a run cannot have taken longer than the session
-- has existed, and that check is one of the assertions below.
insert into public.game_sessions (id, game_id, user_id, seed, rules_version, started_at, expires_at, abandoned_at) values
  (:'pending_session',   :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'expired_session',   :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '3 hours', now() - interval '1 hour', null),
  (:'abandoned_session', :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', now()),
  (:'guest_session',     :'runnable_game', null,     1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'old_rules_session', :'runnable_game', :'alice', 1, 'stack-10@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'bob_session',       :'runnable_game', :'bob',   1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Chain fixtures under the same rules. Seed 1 deals symbols 0,0,2,3,0,0,2,2,0,1:
  -- round 1 is [0], round 2 [0,0], round 3 [0,0,2], and so on to ten rounds.
  (:'chain_session',       :'chain_game', :'alice', 1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_loss_session',  :'chain_game', :'alice', 1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_guest_session', :'chain_game', null,     1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_old_session',   :'chain_game', :'alice', 1, 'chain@0', now() - interval '5 minutes', now() + interval '2 hours', null);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', null)$$,
  'a client cannot insert a session: the server issues it with the seed'
);
select rls_test.denied(
  $$insert into public.scores (session_id, game_id, user_id, score)
    values ('cccccccc-4444-4444-8444-cccccccccccc', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', null, 1)$$,
  'a client cannot write a score row'
);
select rls_test.denied(
  $$update public.game_sessions set completed_at = now() where id = 'cccccccc-4444-4444-8444-cccccccccccc'$$,
  'a client cannot close its own session'
);
select rls_test.denied(
  $$select id from public.game_sessions$$,
  'anonymous callers cannot read session rows at all'
);

-- The aggregate is public; the row-level table it is built from is not, and the
-- internal uuid is not part of the aggregate a caller may read.
select rls_test.allow($$select slug, plays from public.game_stats$$,
  'anon reads published aggregate activity');
select rls_test.denied($$select game_id from public.game_stats$$,
  'the internal game id is not granted on the public aggregate');
select rls_test.visible($$select * from public.game_leaderboard('fixture-secret', null, 10, 0)$$, 0,
  'an unpublished game has no public board');
select rls_test.visible($$select * from public.game_leaderboard('fixture-runnable', null, 10, 0)$$, 0,
  'a playable game with no recorded score has an empty board');

-- Starting a run: only a published, playable game, and only with the rules the
-- database can verify.
select rls_test.says(
  $$public.start_game_session('fixture-secret', 'stack-10@1', 'test')$$,
  'not_playable', 'an unpublished game cannot start a run'
);
select rls_test.says(
  $$public.start_game_session('fixture-stack', 'stack-10@1', 'test')$$,
  'not_playable', 'a published game with no runtime cannot start a run'
);
select rls_test.says(
  $$public.start_game_session('no-such-game-anywhere', 'stack-10@1', 'test')$$,
  'not_playable', 'an unknown slug is refused exactly like an unpublished one'
);
select rls_test.raises(
  $$select public.start_game_session('Not A Slug', 'stack-10@1', 'test')$$,
  '22023', 'a malformed slug is a request error, not a catalogue lookup'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@2', 'test')$$,
  'unsupported_runtime', 'rules the verifier does not implement are refused at the door'
);
-- The shipped game itself, not a fixture: after every migration has been applied,
-- the catalogue's own Stack 10 record is playable, carries its runtime, and can
-- issue a run to a guest. This is the production shape, asserted in the same suite
-- that runs the migration.
select rls_test.visible(
  $$select 1 from public.games where slug = 'stack-10' and playable and runtime = 'stack-10'$$,
  1, 'the shipped Stack 10 game is playable and names its runtime'
);
-- `fixture-%` are this suite's own playable games (the ones the refusal paths
-- need), so the claim is about the catalogue: of the games this repository
-- ships, only the two with runtimes are playable.
select rls_test.visible(
  $$select 1 from public.games
     where slug not in ('stack-10', 'dont-break-the-chain') and slug not like 'fixture-%' and (playable or runtime is not null)$$,
  0, 'no shipped game besides the two runtimes is marked playable'
);
select rls_test.says_field(
  $$public.start_game_session('stack-10', 'stack-10@1', 'test/1.0')$$,
  'game_slug', 'stack-10', 'the shipped game issues a run like any other'
);
-- The shipped Chain game, same shape: playable, naming its runtime, issuing a
-- run whose move count is taps rather than tiles.
select rls_test.visible(
  $$select 1 from public.games where slug = 'dont-break-the-chain' and playable and runtime = 'chain'$$,
  1, 'the shipped Chain game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('dont-break-the-chain', 'chain@1', 'test/1.0')$$,
  'game_slug', 'dont-break-the-chain', 'the shipped Chain game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('dont-break-the-chain', 'chain@1', 'test/1.0')$$,
  'tile_count', '55', 'a Chain session counts the taps of a perfect run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'a guest can start a run'
);
select rls_test.says_field(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'tile_count', '60', 'the server tells the client how long the run is'
);
-- The gate is a pair: a Stack 10 game with Chain rules, and a Chain game with
-- Stack 10 rules, are both versions no verifier owns.
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'chain@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a Chain run'
);
select rls_test.says(
  $$public.start_game_session('fixture-chain', 'stack-10@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Chain game cannot start a Stack 10 run'
);
select rls_test.says(
  $$public.start_game_session('fixture-chain', 'chain@1', 'test/1.0')$$,
  'started', 'a guest can start a Chain run'
);

-- A guest run completes and is verified, and stays unranked: there is no score
-- row for it, because `scores.user_id` is NOT NULL by design.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'recorded', 'a guest run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'duplicate', 'a repeated submission of the same run is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'ranked', 'false', 'a guest run is never ranked'
);
-- A guest Chain run completes the same way: verified, recorded, unranked.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'recorded', 'a guest Chain run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'duplicate', 'a repeated guest Chain submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'ranked', 'false', 'a guest Chain run is never ranked'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111')$$,
  'a signed-in player cannot insert a session either: the seed has to be the server''s'
);

-- Refusals: another player's session, a guest session, an expired one, an
-- abandoned one, and rules this database cannot verify.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-6666-4666-8666-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'not_found', 'another player''s session is not found, and not distinguished from missing'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'not_found', 'a guest run cannot be claimed by a signed-in caller'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-2222-4222-8222-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'expired', 'a run cannot be completed after its session expired'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-3333-4333-8333-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'abandoned', 'a replaced run cannot be submitted'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-5555-4555-8555-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'wrong_rules', 'a session pinned to rules this verifier does not implement is refused'
);

-- Refusals: a run the rules cannot have produced. Each one leaves the session
-- open, so the same fixture can be used for the next attempt.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 999999999)$$, :'greedy_run'),
  'invalid_duration', 'a claim that the run took longer than the session has existed is impossible'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0,0,1,0,0,0,2,2,2,3], 55, 45000)$$,
  'invalid_actions', 'a partial run is not a finished run: the ending move cannot be dropped'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0,0,4], 55, 45000)$$,
  'invalid_actions', 'a column that does not exist is impossible play'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s || 0, 55, 45000)$$, :'greedy_run'),
  'invalid_actions', 'play cannot continue after the run ended'
);
select rls_test.raises(
  $$select public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[null]::integer[], 55, 45000)$$,
  '22023', 'a ragged action list is a request error, not a scored run'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 999, 45000)$$, :'greedy_run'),
  'score_mismatch', 'a score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 999, 45000)$$, :'greedy_run'),
  'score', '55', 'the replay is the score, and it is reported back'
);

-- The real submission, then a retry of it.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'recorded', 'a legal run is recorded'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'duplicate', 'a retry of the same submission is safe to repeat'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'ranked', 'true', 'a signed-in run is ranked'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0], 55, 45000)$$,
  'closed', 'a closed session does not accept a different run in place of the recorded one'
);
select rls_test.ok(
  (select verified_score = 55 from public.game_sessions where id = 'cccccccc-1111-4111-8111-cccccccccccc'),
  'a player can read the verified score on their own session'
);
select rls_test.ok(
  (select rank = 1 and score = 55 from public.game_standing('fixture-runnable', '11111111-1111-4111-8111-111111111111', null)),
  'your standing on the board is your recorded best at its real rank'
);

-- ── Chain: the same properties, replayed against a growing sequence ──
--
-- Seed 1 deals 0,0,2,3,0,0,2,2,0,1: round 1 is [0], round 2 [0,0], round 3
-- [0,0,2], and so on to ten rounds. The perfect line below is those 55 taps
-- for 55 points and ten cleared rounds; the loss line reproduces rounds one
-- and two and then breaks the chain for 3 points and two cleared rounds. The
-- expected numbers are arithmetic from the seed, not values read back.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'recorded', 'a perfect Chain run is recorded'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'score', '55', 'the replay counts every correct tap'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'duplicate', 'a retry of the same Chain run is safe to repeat'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, array[0], 55, 45000)$$,
  'closed', 'a closed Chain session does not accept a different run'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_perfect'),
  'score_mismatch', 'a Chain score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_perfect'),
  'score', '55', 'the Chain replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0], 3, 45000)$$,
  'invalid_actions', 'a Chain run that stops before the tenth round is cleared is partial'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1,0], 3, 45000)$$,
  'invalid_actions', 'taps after the tap that broke the chain are impossible play'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[4], 0, 45000)$$,
  'invalid_actions', 'a pad that does not exist is impossible play'
);
select rls_test.raises(
  $$select public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Chain action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-5555-4555-8555-dddddddddddd'::uuid, array[0], 0, 45000)$$,
  'wrong_rules', 'a Chain session pinned to other rules is refused by its own verifier'
);
-- The loss is a recorded run, not a discarded one: three correct taps, two
-- cleared rounds, four taps placed including the tap that broke the chain.
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1], 3, 45000)$$,
  'recorded', 'a broken chain is recorded with the taps it earned'
);
select rls_test.says_field(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1], 3, 45000)$$,
  'score', '3', 'a broken chain keeps only its correct taps'
);
select rls_test.ok(
  (select verified_score = 3 from public.game_sessions where id = 'dddddddd-2222-4222-8222-dddddddddddd'),
  'a player can read the verified score on their own Chain session'
);
select rls_test.ok(
  (select rank = 1 and score = 55 from public.game_standing('fixture-chain', '11111111-1111-4111-8111-111111111111', null)),
  'your Chain standing is your recorded best at its real rank'
);

-- Starting replaces your own open run, so a player cannot accumulate runs and
-- pick one to submit later. This runs after the completion tests on purpose:
-- replacing the open run is exactly what it does, and the fixtures above are
-- open until they are submitted.
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'a signed-in player starts a real run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'starting again is allowed'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.game_sessions where game_id = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111' and completed_at is null and abandoned_at is null$$) = 1,
  'exactly one run stays open: the previous one was abandoned'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.game_sessions where game_id = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111' and abandoned_at is not null$$) >= 1,
  'the replaced run is marked abandoned rather than deleted'
);

reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- The board is public, and it is the real ranking of the recorded score.
select rls_test.visible($$select * from public.game_leaderboard('fixture-runnable', null, 10, 0)$$, 1,
  'the board lists exactly the players with a recorded score'
);
select rls_test.ok(
  (select score = 55 and rank = 1 and plays = 1 from public.game_leaderboard('fixture-runnable', null, 10, 0)),
  'the top of the board is the verified score, at rank one, with one scored run'
);
select rls_test.ok(
  (select username is not null from public.game_leaderboard('fixture-runnable', null, 10, 0)),
  'a board entry names its player'
);
select rls_test.visible($$select * from public.game_standing('fixture-runnable', '22222222-2222-4222-8222-222222222222', null)$$, 0,
  'a player with no recorded score has no standing'
);
-- The Chain board is the same shape: one ranked player, the verified 55 on
-- top, two scored runs behind it (the perfect run and the broken chain).
select rls_test.visible($$select * from public.game_leaderboard('fixture-chain', null, 10, 0)$$, 1,
  'the Chain board lists exactly the players with a recorded score'
);
select rls_test.ok(
  (select score = 55 and rank = 1 and plays = 2 from public.game_leaderboard('fixture-chain', null, 10, 0)),
  'the top of the Chain board is the verified score, at rank one, with two scored runs'
);

reset role;

-- Row state, read as the table's owner: the guest run closed with a verified
-- score and wrote no ranked score row, and the retry wrote none either.
select rls_test.ok(
  (select verified_score = 55 and verified_digest is not null and completed_at is not null
     from public.game_sessions where id = 'cccccccc-4444-4444-8444-cccccccccccc'),
  'a guest run closes with a verified score on the session'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'cccccccc-4444-4444-8444-cccccccccccc'$$) = 0,
  'a guest run records no ranked score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'cccccccc-1111-4111-8111-cccccccccccc'$$) = 1,
  'a retried completion leaves exactly one score for the session'
);
select rls_test.ok(
  (select verified_score = 55 and verified_digest is not null and completed_at is not null
     from public.game_sessions where id = 'dddddddd-4444-4444-8444-dddddddddddd'),
  'a guest Chain run closes with a verified score on the session'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'dddddddd-4444-4444-8444-dddddddddddd'$$) = 0,
  'a guest Chain run records no ranked score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'dddddddd-2222-4222-8222-dddddddddddd'$$) = 1,
  'a broken chain leaves exactly one score for the session'
);

-- Plays are completed sessions, counted by the database: one ranked run plus one
-- guest run, one distinct signed-in player, and the best recorded score.
select rls_test.ok(
  (select plays = 2 and players = 1 and best_score = 55 from public.game_stats where slug = 'fixture-runnable'),
  'the public activity counts completed runs, distinct players and the best score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.game_stats where slug = 'fixture-secret'$$) = 0,
  'an unpublished game is not in the public aggregate at all'
);
-- Chain activity counts the same way: three completed runs (two ranked, one
-- guest), one distinct signed-in player, and the best recorded score.
select rls_test.ok(
  (select plays = 3 and players = 1 and best_score = 55 from public.game_stats where slug = 'fixture-chain'),
  'the public activity counts Chain runs, players and the best score'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- New surfaces: preferences, blocks, follow notifications, following feed
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Preferences are strictly per-user.
select rls_test.allow(
  $$insert into public.user_preferences (user_id, private_account) values ('11111111-1111-4111-8111-111111111111', true)
    on conflict (user_id) do update set private_account = excluded.private_account$$,
  'a player can write their own preferences'
);
select rls_test.visible($$select user_id from public.user_preferences where user_id = '11111111-1111-4111-8111-111111111111'$$, 1,
  'a player reads their own preferences');
select rls_test.visible($$select user_id from public.user_preferences where user_id = '22222222-2222-4222-8222-222222222222'$$, 0,
  'another player''s preferences are invisible');
select rls_test.denied(
  $$insert into public.user_preferences (user_id) values ('22222222-2222-4222-8222-222222222222')$$,
  'a player cannot write another user''s preferences'
);

-- Blocks are strictly per-user, and self-blocks are rejected.
select rls_test.allow(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    on conflict do nothing$$,
  'a player can block another account'
);
select rls_test.visible($$select blocked_id from public.blocked_users where blocker_id = '11111111-1111-4111-8111-111111111111'$$, 1,
  'a player reads their own block list');
select rls_test.rejected(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$$,
  'self-blocking is rejected'
);
select rls_test.denied(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')$$,
  'a player cannot block as another user'
);

-- A genuine follow notifies the followee, and only the followee.
select rls_test.allow(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$,
  'a player can follow another account'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.notifications where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'follow'$$) = 0,
  'a follow notifies nobody except the followee'
);
-- Notification rows belong to the followee, so only the followee (or the
-- table owner, who bypasses RLS) can count them — alice reading bob's inbox
-- must see zero rows even though the row exists.
select rls_test.visible($$select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'follow'$$, 0,
  'a follow notification is invisible to anyone but its recipient');
reset role;
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'follow'$$) = 1,
  'a follow creates exactly one follow notification for the followee'
);
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;
select rls_test.blocked(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    on conflict do nothing$$,
  'following an already-followed account touches no row (idempotent retry, no duplicate notification)'
);

-- The Following feed: bob's published game appears for alice, drafts and
-- official ownerless games do not, and strangers' games do not.
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50)) >= 1,
  'a follower''s feed is non-empty'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-bob') = 1,
  'the feed contains the followed creator''s published game'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-draft') = 0,
  'the feed never contains drafts'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where is_official) = 0,
  'the feed never contains official ownerless games'
);
select rls_test.ok(
  (select count(*) from public.following_feed('33333333-3333-4333-8333-333333333333', 50)) = 0,
  'an account that follows nobody gets an empty feed, not an error'
);

reset role;

-- The feed reads public rows, so anonymous execution reveals nothing private.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-bob') = 1,
  'the feed output is public data either way'
);
reset role;

rollback;

\echo 'RLS suite passed.'
