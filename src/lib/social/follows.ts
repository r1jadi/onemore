/**
 * Persistent follow/unfollow backed by `public.follows` through the Supabase
 * Data API. RLS is the boundary: inserts require `follower_id = auth.uid()`
 * and deletes require ownership, so the acting user always comes from the
 * verified token and never from a browser-supplied id.
 *
 * Two rules keep the button and the database from ever disagreeing:
 *
 *   - the database is the source of truth for the displayed state. A screen
 *     that did not just read the follow graph loads it here (`useFollowState`)
 *     rather than assuming "not following" because nobody said otherwise;
 *   - the insert is idempotent (`on conflict do nothing`). A follow that
 *     already exists is the same end state the caller asked for, not the
 *     unique-violation error it used to be reported as.
 */

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
};

type FollowRow = { follower_id: string; followee_id: string; created_at: string };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return new ApiError("Sign in to follow creators.", { code: "unauthorized", status: 401 });
    }
    if (error.status === 409 || error.code === "23505") {
      // The insert is idempotent, so a duplicate should never produce this; a
      // caller that does see it reconciles against the follow graph (see
      // `useFollowState`) rather than repeating a message the button it was
      // clicked from may already contradict.
      return new ApiError("You're already following this account.", {
        code: "conflict",
        status: 409,
      });
    }
    return new ApiError("Couldn't update the follow. Try again.", {
      code: "follow_failed",
      status: error.status,
    });
  }
  return new ApiError("Couldn't update the follow. Try again.", { code: "follow_failed" });
}

/** Resolves a username to its profile id via the public projection. */
export async function resolveUserId(username: string): Promise<string | null> {
  const rows = await restGet<PublicProfile[]>(
    `profiles?username=eq.${encodeURIComponent(username.toLowerCase())}&select=id,username,display_name,bio,avatar_path`,
  );
  return rows[0]?.id ?? null;
}

export async function fetchProfileByUsername(username: string): Promise<PublicProfile | null> {
  const rows = await restGet<PublicProfile[]>(
    `profiles?username=eq.${encodeURIComponent(username.toLowerCase())}&select=id,username,display_name,bio,avatar_path`,
  );
  return rows[0] ?? null;
}

export async function searchProfiles(query: string, limit = 8): Promise<PublicProfile[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  // PostgREST `or` with ilike on both columns; the public projection only.
  const filter = `or=(username.ilike.*${encodeURIComponent(q)}*,display_name.ilike.*${encodeURIComponent(q)}*)`;
  return restGet<PublicProfile[]>(
    `profiles?${filter}&select=id,username,display_name,bio,avatar_path&limit=${limit}`,
  );
}

export async function getFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number }> {
  const [followers, following] = await Promise.all([
    restGet<FollowRow[]>(`follows?followee_id=eq.${userId}&select=follower_id`, undefined),
    restGet<FollowRow[]>(`follows?follower_id=eq.${userId}&select=followee_id`, undefined),
  ]);
  return { followers: followers.length, following: following.length };
}

export async function isFollowing(followeeId: string): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const auth = getAuthState();
  if (auth.status !== "authenticated") return false;
  const rows = await restGet<FollowRow[]>(
    `follows?follower_id=eq.${auth.session.userId}&followee_id=eq.${followeeId}&select=follower_id`,
    token,
  );
  return rows.length > 0;
}

export async function followUser(followeeId: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to follow creators.", { code: "unauthorized", status: 401 });
  }
  if (auth.session.userId === followeeId) {
    throw new ApiError("You can't follow yourself.", { code: "bad_request", status: 400 });
  }
  try {
    // `on conflict do nothing` on the follow's own primary key: repeating a
    // follow — a double tap, a retry after a lost response, a second tab —
    // converges on the same single row instead of failing with 23505.
    await restMutate(
      "follows?on_conflict=follower_id,followee_id",
      "POST",
      token,
      {
        follower_id: auth.session.userId,
        followee_id: followeeId,
      },
      "resolution=ignore-duplicates",
    );
  } catch (error) {
    throw toApiError(error);
  }
}

export async function unfollowUser(followeeId: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to follow creators.", { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate(
      `follows?follower_id=eq.${auth.session.userId}&followee_id=eq.${followeeId}`,
      "DELETE",
      token,
    );
  } catch (error) {
    throw toApiError(error);
  }
}

export async function listFollowees(userId: string): Promise<string[]> {
  const rows = await restGet<FollowRow[]>(
    `follows?follower_id=eq.${userId}&select=followee_id`,
    getAccessToken(),
  );
  return rows.map((row) => row.followee_id);
}

export async function listFollowers(userId: string): Promise<string[]> {
  const rows = await restGet<FollowRow[]>(
    `follows?followee_id=eq.${userId}&select=follower_id`,
    getAccessToken(),
  );
  return rows.map((row) => row.follower_id);
}

export async function fetchProfilesByIds(ids: string[]): Promise<PublicProfile[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const filter = `id=in.(${unique.map(encodeURIComponent).join(",")})`;
  return restGet<PublicProfile[]>(
    `profiles?${filter}&select=id,username,display_name,bio,avatar_path`,
  );
}

/**
 * Reactive follow state for one target account.
 *
 * `initial` is a state the caller just read (the search list loads the
 * viewer's followees in one query). When it is omitted the state is loaded
 * from the database, so a screen that never fetched it — a profile page, a
 * connections list — still shows the truth instead of assuming "not
 * following". A sign-in or sign-out re-reads the answer for either kind of
 * caller.
 */
export function useFollowState(targetUserId: string | undefined, initial?: boolean) {
  const seeded = initial !== undefined;
  const [following, setFollowing] = useState(initial ?? false);
  const [loading, setLoading] = useState(!seeded && targetUserId !== undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!seeded) {
      setLoading(true);
      isFollowing(targetUserId)
        .then((value) => {
          if (!cancelled) setFollowing(value);
        })
        .catch(() => {
          // Keep what is on screen; a toggle (or the auth event below)
          // re-reads the state before it reports anything.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    const unsubscribe = subscribeToAuth(() => {
      void isFollowing(targetUserId)
        .then((value) => {
          if (!cancelled) setFollowing(value);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [targetUserId, seeded]);

  async function toggle(): Promise<void> {
    if (!targetUserId || busy) return;
    setBusy(true);
    setError(undefined);
    const desired = !following;
    try {
      if (desired) {
        await followUser(targetUserId);
      } else {
        await unfollowUser(targetUserId);
      }
      setFollowing(desired);
    } catch (err) {
      // The write failed, but it may still have landed (a lost response); the
      // follow graph is the authority on that. Re-read it, adopt its answer and
      // only report the failure when the database still disagrees with what
      // was asked for — never a state the row itself contradicts.
      let reconciled = false;
      try {
        const truth = await isFollowing(targetUserId);
        setFollowing(truth);
        reconciled = truth === desired;
      } catch {
        // The re-read failed too; fall through to the message below.
      }
      if (!reconciled) {
        setError(err instanceof ApiError ? err.message : "Couldn't update the follow. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return { following, loading, busy, error, toggle };
}
