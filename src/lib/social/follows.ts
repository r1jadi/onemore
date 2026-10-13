/**
 * Persistent follow/unfollow backed by `public.follows` through the Supabase
 * Data API. RLS is the boundary: inserts require `follower_id = auth.uid()`
 * and deletes require ownership, so the acting user always comes from the
 * verified token and never from a browser-supplied id.
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
    await restMutate("follows", "POST", token, {
      follower_id: auth.session.userId,
      followee_id: followeeId,
    });
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

/** Reactive follow state for one target account. */
export function useFollowState(targetUserId: string | undefined) {
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    isFollowing(targetUserId)
      .then((value) => {
        if (!cancelled) setFollowing(value);
      })
      .catch(() => {
        if (!cancelled) setFollowing(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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
  }, [targetUserId]);

  async function toggle(): Promise<void> {
    if (!targetUserId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (following) {
        await unfollowUser(targetUserId);
        setFollowing(false);
      } else {
        await followUser(targetUserId);
        setFollowing(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the follow. Try again.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return { following, loading, busy, error, toggle };
}
