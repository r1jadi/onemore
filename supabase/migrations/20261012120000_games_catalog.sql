-- 0004 — The games catalogue: real product metadata, first-party games and the
-- queries the Games service (`services/games`) needs.
--
-- Append-only. Migrations 0001–0003 have already run against the hosted project
-- and are never edited; everything here either adds to them or widens one rule
-- that the catalogue makes wrong (`games.owner_id` was NOT NULL, which a
-- first-party game has no account to satisfy).
--
-- Two deliberate additions beyond columns:
--
--   * `public.category_game_counts` — a view, because PostgREST cannot GROUP BY
--     and the Categories screen needs a real published-game count per category.
--     Its only output is an aggregate over rows that are public anyway, and the
--     `status = 'published'` filter lives inside the view, so it cannot widen
--     what an anonymous caller already reads from `games`.
--   * The seven first-party games below. They are the product's real catalogue
--     (title, tagline, description, instructions, category). They carry **no**
--     play count, rating or creator of any kind: none of those exist yet, and a
--     fabricated number in production is worse than a missing one. They are
--     `published` so they are browsable and clickable with a stable slug, and
--     `playable = false` because no game runtime has been built — the UI must
--     not offer a Play button that cannot run anything.

-- ─────────────────────────────────────────────────────────────────────────────
-- games: the fields the catalogue screens genuinely need
-- ─────────────────────────────────────────────────────────────────────────────

-- First-party content is owned by the platform, not by an account, so the owner
-- becomes optional. `games_owner_or_official` below is what keeps the column
-- meaningful: only an explicitly official game may have no owner.
alter table public.games alter column owner_id drop not null;

alter table public.games add column if not exists instructions text;
alter table public.games add column if not exists runtime text;
alter table public.games add column if not exists playable boolean not null default false;
alter table public.games add column if not exists cover_path text;
alter table public.games add column if not exists is_official boolean not null default false;

comment on column public.games.instructions is
  'How to play, shown on the game detail page. Null while a game has no written rules.';
comment on column public.games.runtime is
  'Identifier of the client runtime that plays this game (see games/runtime). Null means no runtime exists yet.';
comment on column public.games.playable is
  'True only when `runtime` names a runtime that actually exists. A published but unplayable game is listed, not playable.';
comment on column public.games.cover_path is
  'Object path inside the `game-assets` bucket, `<slug>/<file>`. Null until real art is uploaded.';
comment on column public.games.is_official is
  'First-party OneMore content. Immutable through the Data API; only the service role may set it.';

-- Integrity rules the database enforces for every writer. The naming and the
-- style follow 0001 so a constraint failure is diagnosable from its name alone.

-- A Play button may only appear for a game whose runtime exists.
alter table public.games drop constraint if exists games_playable_requires_runtime;
alter table public.games add constraint games_playable_requires_runtime
  check (not playable or runtime is not null);

alter table public.games drop constraint if exists games_runtime_format;
alter table public.games add constraint games_runtime_format
  check (runtime is null or runtime ~ '^[a-z0-9-]{2,48}$');

alter table public.games drop constraint if exists games_instructions_length;
alter table public.games add constraint games_instructions_length
  check (instructions is null or char_length(instructions) between 1 and 4000);

-- Same shape as `profiles.avatar_path_format`: an object path under the slug's
-- own folder, so a cover can never point at somebody else's asset.
alter table public.games drop constraint if exists games_cover_path_format;
alter table public.games add constraint games_cover_path_format
  check (cover_path is null or cover_path ~ '^[a-z0-9-]{2,48}/[a-z0-9._-]{1,120}$');

-- The rule that keeps a nullable owner honest: every game either has an owner or
-- is explicitly first-party content.
alter table public.games drop constraint if exists games_owner_or_official;
alter table public.games add constraint games_owner_or_official
  check (is_official or owner_id is not null);

-- The catalogue's own ordering key. A partial index because only published rows
-- are ever listed publicly, and it is the exact expression the list query and
-- its keyset cursor use (`published_at desc, id desc`).
create index if not exists games_catalog_order_idx
  on public.games (published_at desc, id desc)
  where status = 'published';

-- `is_official` is a platform property, not a field a client may set. The same
-- trigger shape as `games_owner_is_immutable` (0003) so a forged request fails
-- with the same kind of error.
drop trigger if exists games_official_is_immutable on public.games;
create trigger games_official_is_immutable
  before update on public.games
  for each row
  when (new.is_official is distinct from old.is_official)
  execute function public.reject_change('is_official');

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies: a client may never mint first-party content or a playable game
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Recreated rather than added to: the existing insert/update policies predate
-- `is_official`, so they say nothing about it. Both keep their original rule
-- verbatim and gain the one clause that closes the new hole.

drop policy if exists games_insert_own_draft on public.games;
create policy games_insert_own_draft
  on public.games for insert to authenticated
  with check (owner_id = auth.uid() and status in ('draft', 'review') and not is_official);

drop policy if exists games_update_own on public.games;
create policy games_update_own
  on public.games for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status in ('draft', 'review') and not is_official);

-- `games_select_visible`, `games_delete_own_draft` and `games_moderate_staff` are
-- unchanged: visibility already keys on `status`, deletion already keys on
-- ownership plus draft, and staff already hold the only path to publishing.

-- ─────────────────────────────────────────────────────────────────────────────
-- Real per-category counts
-- ─────────────────────────────────────────────────────────────────────────────

-- `security_invoker = true` makes the view run with the *caller's* rights and
-- RLS, so an anonymous visitor cannot read a count this project would refuse to
-- give them through `games`. The `status = 'published'` filter is inside the
-- view as well, so the number is published games even when a staff or owner
-- caller could see more.
drop view if exists public.category_game_counts;
create view public.category_game_counts
  with (security_invoker = true)
as
select
  c.slug,
  c.name,
  c.description,
  c.sort_order,
  count(g.id) as game_count
from public.categories c
left join public.games g
  on g.category_id = c.id
 and g.status = 'published'
group by c.id, c.slug, c.name, c.description, c.sort_order;

-- 0003 revoked the default grants, so a new view starts closed. If it fails to
-- run this migration, the contract and the API go out of step with the database.
grant select on public.category_game_counts to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The real catalogue
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Data migration, not a seed: `supabase db push` applies migrations and not
-- `seed.sql`, so this is the only way the real catalogue reaches production
-- without a manual dashboard step. It is idempotent (`on conflict (slug) do
-- update`) for the same reason `seed.sql` is.
--
-- The categories are upserted first with the same values as `supabase/seed.sql`,
-- because `supabase db reset` runs migrations *before* the seed and the games
-- below need a `category_id` to reference. The two lists are identical; if a
-- category is ever added, both are updated together.

insert into public.categories (slug, name, description, sort_order) values
  ('puzzle',   'Puzzle',   'Fit, merge and clear under pressure.',        10),
  ('arcade',   'Arcade',   'Fast reflexes, one wrong tap and it is over.', 20),
  ('logic',    'Logic',    'One correct move per level.',                 30),
  ('reaction', 'Reaction', 'Speed and pattern chains.',                   40),
  ('memory',   'Memory',   'See it once, rebuild it.',                    50),
  ('daily',    'Daily',    'One attempt per day.',                        60),
  ('word',     'Word',     'Letters, anagrams and word chains.',          70),
  ('strategy', 'Strategy', 'Fewer moves, better plan.',                   80)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  v.slug, v.title, v.tagline, v.description, v.instructions,
  (select c.id from public.categories c where c.slug = v.category),
  'published', true, false, null, v.published_at
from (values
  (
    'stack-10', 'Stack 10', 'Make every column add up to ten.',
    'Drop numbered tiles into columns. Hit exactly ten to clear. Overflow and it is over.',
    'Tap a column to drop the next tile. A column that passes ten ends the run. Clear the board to keep going.',
    'puzzle', timestamptz '2026-09-01 12:00:00+00'
  ),
  (
    'color-merge', 'Color Merge', 'Merge matching tiles. Fill nothing.',
    'Slide the grid, merge equal colors into the next shade. Run out of moves and the board locks.',
    'Swipe to slide every tile. Two equal tiles merge into the next shade. No move available ends the run.',
    'puzzle', timestamptz '2026-09-03 12:00:00+00'
  ),
  (
    'dont-touch-the-black', 'Don''t Touch the Black', 'Tap white. Only white.',
    'Rows scroll faster every second. One wrong tap ends the run.',
    'Tap the white tiles as they reach the line. Never tap a black tile: that ends the run immediately.',
    'arcade', timestamptz '2026-09-05 12:00:00+00'
  ),
  (
    'memory-flash', 'Memory Flash', 'See it once. Rebuild it.',
    'A pattern flashes for half a second. Rebuild it cell by cell.',
    'Watch the lit cells, then reproduce them in any order. One mistake resets the level.',
    'memory', timestamptz '2026-09-08 12:00:00+00'
  ),
  (
    '7-second', '7 Second', 'Today''s challenge. Seven seconds.',
    'A new micro challenge every day. You get one attempt per day to set your score.',
    'One attempt per calendar day. Seven seconds on the clock; every correct response adds time.',
    'daily', timestamptz '2026-09-10 12:00:00+00'
  ),
  (
    'dont-break-the-chain', 'Don''t Break the Chain', 'Repeat the chain. Add one more.',
    'Watch the sequence, repeat it, survive the next link. Reaction meets memory.',
    'Each round shows a sequence one link longer. Reproduce it in order to continue.',
    'reaction', timestamptz '2026-09-14 12:00:00+00'
  ),
  (
    'one-move', 'One Move', 'One move. One solution.',
    'Each level has exactly one move that solves it. Find it.',
    'Every level has a single winning move. Any other move resets the level.',
    'logic', timestamptz '2026-09-16 12:00:00+00'
  )
) as v (slug, title, tagline, description, instructions, category, published_at)
on conflict (slug) do update
  set title       = excluded.title,
      tagline     = excluded.tagline,
      description = excluded.description,
      instructions = excluded.instructions,
      category_id = excluded.category_id,
      status      = excluded.status,
      is_official = excluded.is_official,
      playable    = excluded.playable,
      runtime     = excluded.runtime,
      published_at = excluded.published_at;
