-- Like and comment counts for many games in one read.
--
-- The feed used to ask for each game's like count and comment count separately:
-- two requests per card, fourteen for a seven-game feed. This view answers them
-- all at once (`?slug=in.(…)`), and the client falls back to the old per-game
-- reads when the view is not there yet, so the migration and the deploy can land
-- in either order.
--
-- `security_invoker = true` runs the view with the caller's rights and RLS, so
-- the counts are exactly the ones the per-game reads return for the same caller:
-- a hidden comment that a visitor cannot read is not counted for them either.
drop view if exists public.game_engagement_counts;
create view public.game_engagement_counts
  with (security_invoker = true)
as
select
  g.id   as game_id,
  g.slug,
  (select count(*) from public.likes l
    where l.target_kind = 'game' and l.target_id = g.id)::integer as like_count,
  (select count(*) from public.comments c
    where c.game_id = g.id)::integer                                as comment_count
from public.games g
where g.status = 'published';

grant select on public.game_engagement_counts to anon, authenticated;
