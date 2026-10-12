-- 0008 — Two reads the admin service needs that are not moderation data.
--
--   1. `public.admin_identity()` answers "who am I, and what role do I hold?" from
--      the database, for the caller and nobody else. The web app needs it to
--      decide whether to show the dashboard at all, and the admin service calls it
--      to make the *authorization* decision from `public.user_roles` rather than
--      from a claim in the token. A role claim and a role row can disagree (one is
--      written by Supabase's admin API, the other by this database); when they do,
--      the row wins and the caller is refused.
--
--      It is deliberately not staff-gated: an ordinary signed-in caller must be
--      able to learn that they are not staff, or the only possible answer would be
--      a 403 they cannot interpret. It exposes the caller's own row and nothing
--      else, exactly like `public.current_role()`.
--
--   2. `public.admin_category_directory()` is the category list with both counts a
--      moderator needs: how many games are *published* in it (the number the
--      public catalogue shows) and how many exist at all. The public
--      `category_game_counts` view answers only the first question, because a
--      published-game count is all a visitor may have.

create or replace function public.admin_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'userId',      coalesce(auth.uid()::text, ''),
    'username',    coalesce(pr.username::text, ''),
    'displayName', coalesce(pr.display_name, ''),
    'role',        public.current_role()::text,
    'isStaff',     public.is_staff(),
    'isAdmin',     public.is_admin(),
    'isSuspended', coalesce(pr.is_suspended, false)
  )
  from (select 1) as one
  left join public.profiles pr on pr.id = auth.uid();
$$;

comment on function public.admin_identity() is
  'The caller''s own role, username and suspension state, read from public.user_roles. Exposes only the caller''s row; no role is required to call it.';

create or replace function public.admin_category_directory()
returns table (
  slug text,
  name text,
  description text,
  sort_order integer,
  published_games bigint,
  total_games bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard_staff();

  return query
  select
    c.slug::text,
    c.name,
    c.description,
    c.sort_order,
    (select count(*) from public.games g
      where g.category_id = c.id and g.status = 'published'),
    (select count(*) from public.games g where g.category_id = c.id)
  from public.categories c
  order by c.sort_order asc, c.slug asc;
end;
$$;

comment on function public.admin_category_directory() is
  'Every category with its real published and total game counts, including unpublished games the public count cannot see. Requires staff.';

revoke all on function public.admin_identity() from public, anon;
revoke all on function public.admin_category_directory() from public, anon;

grant execute on function public.admin_identity() to authenticated;
grant execute on function public.admin_category_directory() to authenticated;
