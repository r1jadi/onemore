-- 0003 — storage buckets and their policies.
--
-- Storage is the highest risk surface in most Supabase projects, so the rules
-- are explicit and narrow:
--   * a bucket is either public (world-readable, for content that is already
--     public on the web) or private (signed URLs only);
--   * uploads are size limited and MIME limited per bucket, and the MIME list is
--     an allowlist, never a blocklist;
--   * every object lives under a folder named after the uploader's user id and
--     only the owner may write inside their own folder. Path and database row
--     must agree, so a user cannot overwrite someone else's avatar by guessing a
--     path;
--   * uploads never execute: the buckets serve static bytes, and the web app
--     renders them with an <img> tag, never as HTML.
--
-- Files are neither scanned nor transcoded here. A moderation task will add
-- server-side scanning before submissions are published.

-- ─────────────────────────────────────────────────────────────────────────────
-- Buckets
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'avatars',
    'avatars',
    true,
    2 * 1024 * 1024,
    array['image/png', 'image/jpeg', 'image/webp']
  ),
  (
    'game-assets',
    'game-assets',
    true,
    10 * 1024 * 1024,
    array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
  ),
  (
    'game-builds',
    'game-builds',
    false,
    50 * 1024 * 1024,
    array[
      'application/zip',
      'application/json',
      'text/html',
      'application/javascript',
      'text/javascript',
      'text/css'
    ]
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- Object policies
--
-- The first path segment must be the caller's user id:
--   avatars/<user-id>/<file>
-- ─────────────────────────────────────────────────────────────────────────────

create policy "avatars_public_read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

create policy "avatars_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "game_assets_public_read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'game-assets');

create policy "game_assets_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'game-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "game_assets_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- game-builds is private: only the owner reads and writes, and the public web
-- app never links to it directly.
create policy "game_builds_owner_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'game-builds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "game_builds_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'game-builds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "game_builds_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-builds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Staff moderation reads submissions without gaining write access to them.
create policy "game_builds_staff_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'game-builds' and public.is_staff());
