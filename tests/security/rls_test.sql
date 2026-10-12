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
select rls_test.denied(
  $$update public.profiles set username = 'someone_else' where id = '11111111-1111-4111-8111-111111111111'$$,
  'usernames are not updatable through the Data API'
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
select rls_test.denied(
  $$update public.profiles set is_suspended = true where id = '22222222-2222-4222-8222-222222222222'$$,
  'suspension is not writable through the Data API, even for an administrator'
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

rollback;

\echo 'RLS suite passed.'
