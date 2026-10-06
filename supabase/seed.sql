-- Seed data for local development and preview environments.
--
-- Reference data only: no accounts, no credentials, no scores. Auth users are
-- created through Supabase Auth (dashboard, `supabase auth` or a test harness),
-- never by inserting into `auth.users` here.
--
-- `supabase db reset` runs this file after every migration, so it must stay
-- idempotent.

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
