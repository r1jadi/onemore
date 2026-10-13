-- 0011 — genuine follow notifications.
--
-- APPLY ORDER: after 0010. Manual application only.
--
-- Clients cannot insert into public.notifications (no insert grant by design),
-- so a follow would otherwise never notify anyone. This trigger creates one
-- `follow` notification for the followee when a follow row is inserted, as a
-- security-definer function that reads the follower's username itself. No
-- request parameter selects the recipient: the recipient is the followee.
--
-- Only genuine events create rows: one per follow insert, deduplicated by the
-- follows primary key (no duplicate follows, no duplicate notifications from
-- retries that conflict). Unfollow deletes nothing (history stays read as-is).
--
-- Rollback (manual):
--   drop trigger if exists follows_notify_followee on public.follows;
--   drop function if exists public.notify_follow();

create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  follower_username text;
begin
  select p.username into follower_username
  from public.profiles p
  where p.id = new.follower_id;

  insert into public.notifications (user_id, kind, payload)
  values (
    new.followee_id,
    'follow',
    jsonb_build_object(
      'username', coalesce(follower_username, 'someone'),
      'text', 'started following you'
    )
  );
  return new;
exception when others then
  -- A notification must never break a follow. Log via raise warning (visible
  -- in Postgres logs) and let the insert succeed.
  raise warning 'notify_follow failed for followee %: %', new.followee_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists follows_notify_followee on public.follows;
create trigger follows_notify_followee
  after insert on public.follows
  for each row execute function public.notify_follow();

-- Verification:
--   select proname from pg_proc where proname = 'notify_follow';
--   insert a test follow in a dev project and check public.notifications for the followee.
--   delete the test rows afterwards; never seed production notifications.
