/**
 * Persistent likes, comments and saves backed by Supabase tables through the
 * Data API. RLS is the boundary: inserts and deletes require the row to belong
 * to `auth.uid()`, so the acting user always comes from the verified token and
 * never from a browser-supplied id — the same pattern `follows.ts` uses.
 *
 * What lives where:
 *
 *   - `public.likes` (user_id, target_kind, target_id) — the primary key is the
 *     duplicate guard, so a second like conflicts instead of inserting and
 *     concurrent requests cannot create two rows. Likes are public; states are
 *     per-caller.
 *   - `public.comments` (game_id, author_id, body, …) — top-level only
 *     (`parent_id IS NULL` is enforced by RLS), 1–2000 characters by CHECK, on
 *     published games only. Authors read their own hidden rows; everyone else
 *     reads visible ones. Authors delete their own; hiding runs through the
 *     moderation service, never through this module.
 *   - `public.saves` (user_id, game_id) — private rows: no anonymous grant, and
 *     every policy is owner-scoped. Only published games can be saved.
 *
 * The catalogue API deliberately omits game uuids, so slugs are resolved to ids
 * through the public games projection first. Every count below is measured —
 * an exact `Content-Range` total or a row list that is counted — never a
 * placeholder.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import type { Game } from "@/lib/games/catalog";
import { fetchProfilesByIds, type PublicProfile } from "@/lib/social/follows";
import { restCount, restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export const MAX_COMMENT_LENGTH = 2000;
const COMMENT_PAGE_SIZE = 100;
const LIST_PAGE_SIZE = 200;

type GameIdRow = { id: string; slug: string };

type LikeRow = { user_id: string; target_kind: "game" | "comment"; target_id: string };

type SaveRow = { user_id: string; game_id: string; created_at: string };

type CommentRow = {
  id: string;
  game_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
};

type GameRecord = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  instructions: string | null;
  runtime: string | null;
  playable: boolean;
  is_official: boolean;
  cover_path: string | null;
  published_at: string | null;
  updated_at: string;
  categories: { slug: string; name: string } | null;
};

type GameStatRow = { slug: string; plays: number };

export type GameComment = {
  id: string;
  gameId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: PublicProfile | null;
};

function toApiError(error: unknown, area: "like" | "comment" | "save" | "score"): ApiError {
  const nouns = {
    like: "Couldn't update the like. Try again.",
    comment: "Couldn't load comments. Try again.",
    save: "Couldn't update the saved games. Try again.",
    score: "Couldn't load your scores. Try again.",
  } as const;
  const codes = {
    like: "like_failed",
    comment: "comment_failed",
    save: "save_failed",
    score: "score_failed",
  } as const;
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return new ApiError("Sign in to join the conversation.", {
        code: "unauthorized",
        status: 401,
      });
    }
    return new ApiError(nouns[area], { code: codes[area], status: error.status });
  }
  return new ApiError(nouns[area], { code: codes[area] });
}

function requireCaller(): { token: string; userId: string } {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to join the conversation.", {
      code: "unauthorized",
      status: 401,
    });
  }
  return { token, userId: auth.session.userId };
}

/** A PostgREST unique violation: the row already exists, which is a success for
 * an idempotent action rather than a failure. */
function isDuplicate(error: unknown): boolean {
  return error instanceof SupabaseRestError && (error.status === 409 || error.code === "23505");
}

// ── Game id resolution ──────────────────────────────────────────────────────
// The catalogue names games by slug; likes, comments and saves address them by
// uuid. The public games projection resolves one to the other.

/** Resolves one slug to its game id, or null when no published game has it. */
export async function resolveGameId(slug: string): Promise<string | null> {
  const rows = await restGet<GameIdRow[]>(
    `games?slug=eq.${encodeURIComponent(slug)}&select=id,slug&limit=1`,
  );
  return rows[0]?.id ?? null;
}

/** Resolves many slugs in one request. Unknown slugs are absent from the map. */
export async function resolveGameIds(slugs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(slugs.filter((s) => s !== ""))];
  if (unique.length === 0) return new Map();
  const filter = `slug=in.(${unique.map((s) => encodeURIComponent(s)).join(",")})`;
  const rows = await restGet<GameIdRow[]>(`games?${filter}&select=id,slug&limit=${unique.length}`);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

// ── Likes ───────────────────────────────────────────────────────────────────

/** How many players like one game. Public: no token needed. */
export async function fetchLikeCount(gameId: string): Promise<number> {
  return restCount(
    `likes?target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
  );
}

/** Whether the signed-in caller likes one game. Anonymous callers like nothing. */
export async function isLiked(gameId: string): Promise<boolean> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return false;
  const rows = await restGet<LikeRow[]>(
    `likes?user_id=eq.${auth.session.userId}&target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
    token,
  );
  return rows.length > 0;
}

/**
 * Likes a game. A concurrent second like conflicts on the primary key and is
 * reported as already-liked rather than failing: liking is idempotent, so two
 * requests can never create two rows.
 */
export async function likeGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate("likes", "POST", token, {
      user_id: userId,
      target_kind: "game",
      target_id: gameId,
    });
  } catch (error) {
    if (isDuplicate(error)) return;
    throw toApiError(error, "like");
  }
}

/**
 * Unlikes a game. Deleting a row that is not there still answers success, so
 * unliking is idempotent too.
 */
export async function unlikeGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate(
      `likes?user_id=eq.${userId}&target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}`,
      "DELETE",
      token,
    );
  } catch (error) {
    throw toApiError(error, "like");
  }
}

/** The game ids the signed-in caller likes, newest first. */
export async function listLikedGameIds(limit = LIST_PAGE_SIZE): Promise<string[]> {
  const { token, userId } = requireCaller();
  const rows = await restGet<LikeRow[]>(
    `likes?user_id=eq.${userId}&target_kind=eq.game&select=target_id&order=created_at.desc&limit=${limit}`,
    token,
  ).catch((error: unknown) => {
    throw toApiError(error, "like");
  });
  return rows.map((row) => row.target_id);
}

// ── Saves ───────────────────────────────────────────────────────────────────

/** Whether the signed-in caller saved one game. Anonymous callers save nothing. */
export async function isSaved(gameId: string): Promise<boolean> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return false;
  const rows = await restGet<SaveRow[]>(
    `saves?user_id=eq.${auth.session.userId}&game_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
    token,
  );
  return rows.length > 0;
}

/**
 * Saves a game. Like liking, this is idempotent: a concurrent second save
 * conflicts on the primary key and is reported as already-saved.
 */
export async function saveGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate("saves", "POST", token, { user_id: userId, game_id: gameId });
  } catch (error) {
    if (isDuplicate(error)) return;
    throw toApiError(error, "save");
  }
}

/** Removes a save. Removing what is not saved still answers success. */
export async function unsaveGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate(
      `saves?user_id=eq.${userId}&game_id=eq.${encodeURIComponent(gameId)}`,
      "DELETE",
      token,
    );
  } catch (error) {
    throw toApiError(error, "save");
  }
}

/** The game ids the signed-in caller saved, newest first. */
export async function listSavedGameIds(limit = LIST_PAGE_SIZE): Promise<string[]> {
  const { token, userId } = requireCaller();
  const rows = await restGet<SaveRow[]>(
    `saves?user_id=eq.${userId}&select=game_id&order=created_at.desc&limit=${limit}`,
    token,
  ).catch((error: unknown) => {
    throw toApiError(error, "save");
  });
  return rows.map((row) => row.game_id);
}

// ── Comments ────────────────────────────────────────────────────────────────

function toComment(row: CommentRow, authors: Map<string, PublicProfile>): GameComment {
  return {
    id: row.id,
    gameId: row.game_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.updated_at,
    author: authors.get(row.author_id) ?? null,
  };
}

/**
 * One page of a game's comments, oldest first, with author profiles attached.
 * Hidden rows are withheld by RLS unless the caller wrote them or moderates —
 * the list is what the caller may see, never a filtered mock of it.
 */
export async function fetchComments(
  gameId: string,
  limit = COMMENT_PAGE_SIZE,
): Promise<GameComment[]> {
  let rows: CommentRow[];
  try {
    rows = await restGet<CommentRow[]>(
      `comments?game_id=eq.${encodeURIComponent(gameId)}&select=id,game_id,author_id,body,created_at,updated_at&order=created_at.asc&limit=${limit}`,
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const authors = await fetchProfilesByIds(rows.map((row) => row.author_id)).catch(() => []);
  const byId = new Map(authors.map((profile) => [profile.id, profile]));
  return rows.map((row) => toComment(row, byId));
}

/** How many comments a game shows. Public: no token needed. */
export async function fetchCommentCount(gameId: string): Promise<number> {
  try {
    return await restCount(`comments?game_id=eq.${encodeURIComponent(gameId)}&select=id`);
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/**
 * Posts a comment as the signed-in caller. The body is validated here — empty
 * and over-long bodies never reach the database — and again by the CHECK
 * constraint, which stays the authority. Replies are not accepted: RLS only
 * stores top-level comments, so a `parent_id` would be refused as another
 * user's thread shape rather than quietly dropped.
 */
export async function postComment(gameId: string, body: string): Promise<GameComment> {
  const { token, userId } = requireCaller();
  const text = body.trim();
  if (text === "") {
    throw new ApiError("Write a comment first.", { code: "bad_request", status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new ApiError(`Keep comments to ${MAX_COMMENT_LENGTH} characters or fewer.`, {
      code: "bad_request",
      status: 400,
    });
  }
  let rows: CommentRow[];
  try {
    const response = await restMutate(
      "comments",
      "POST",
      token,
      { game_id: gameId, author_id: userId, body: text },
      "return=representation",
    );
    rows = (await response.json()) as CommentRow[];
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const row = rows[0];
  if (!row) {
    throw new ApiError("Couldn't post the comment. Try again.", { code: "comment_failed" });
  }
  const authors = await fetchProfilesByIds([userId]).catch(() => []);
  return toComment(row, new Map(authors.map((profile) => [profile.id, profile])));
}

/**
 * Deletes a comment. Authors remove their own; moderators remove anyone's
 * through the same RLS rule the admin console relies on — anything else is
 * refused by the policy, not by a frontend check.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const { token } = requireCaller();
  try {
    await restMutate(`comments?id=eq.${encodeURIComponent(commentId)}`, "DELETE", token);
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/** The signed-in caller's recent comments, newest first. */
export async function listMyComments(limit = 20): Promise<GameComment[]> {
  const { token, userId } = requireCaller();
  let rows: CommentRow[];
  try {
    rows = await restGet<CommentRow[]>(
      `comments?author_id=eq.${userId}&select=id,game_id,author_id,body,created_at,updated_at&order=created_at.desc&limit=${limit}`,
      token,
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const authors = await fetchProfilesByIds([userId]).catch(() => []);
  const byId = new Map(authors.map((profile) => [profile.id, profile]));
  return rows.map((row) => toComment(row, byId));
}

/** The signed-in caller's recent scores, newest first. */
export async function listMyRecentScores(
  limit = 10,
): Promise<Array<{ gameId: string; score: number; createdAt: string }>> {
  const { token, userId } = requireCaller();
  try {
    return await restGet<Array<{ game_id: string; score: number; created_at: string }>>(
      `scores?user_id=eq.${userId}&select=game_id,score,created_at&order=created_at.desc&limit=${limit}`,
      token,
    ).then((rows) =>
      rows.map((row) => ({ gameId: row.game_id, score: row.score, createdAt: row.created_at })),
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/**
 * The signed-in caller's best verified score per game, highest first.
 *
 * One row per game, taken from the scores the database retained. A game whose
 * only run was a guest run has no row, because an unranked run is not saved —
 * which is the honest answer, not a zero.
 */
export async function listMyBestScores(
  limit = 200,
): Promise<Array<{ gameId: string; score: number }>> {
  const { token, userId } = requireCaller();
  try {
    const rows = await restGet<Array<{ game_id: string; score: number }>>(
      `scores?user_id=eq.${userId}&select=game_id,score&order=score.desc&limit=${limit}`,
      token,
    );
    const best = new Map<string, number>();
    for (const row of rows) {
      if (!best.has(row.game_id)) best.set(row.game_id, row.score);
    }
    return [...best]
      .map(([gameId, score]) => ({ gameId, score }))
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    throw toApiError(error, "score");
  }
}

export type ScoreEntry = { game: Game | null; score: number };

type ScoreListState = {
  entries: ScoreEntry[];
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
};

/** The caller's personal bests, with their catalogue games resolved. */
export function useBestScores(): ScoreListState {
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [status, setStatus] = useState<ScoreListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setEntries([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    listMyBestScores()
      .then(async (rows) => {
        const games = new Map(
          (await fetchGameRecords(rows.map((row) => row.gameId))).map((record) => [
            record.id,
            record.game,
          ]),
        );
        if (cancelled) return;
        setEntries(rows.map((row) => ({ game: games.get(row.gameId) ?? null, score: row.score })));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load your scores. Try again.");
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tick]);

  return { entries, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

/**
 * Games the caller played, newest first, derived from saved scores.
 *
 * There is no separate play-history table. A score is written only when a run
 * finished and was verified, so it is the only record of a played game — using
 * it keeps this page consistent with Activity instead of claiming nothing was
 * played after a scored run.
 */
export function useRecentlyPlayed(limit = 20): GameListState {
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState<GameListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setGames([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    listMyRecentScores(limit)
      .then(async (rows) => {
        // Newest first, one card per game: the score list can name a game more
        // than once and the page is "games you played", not "runs you played".
        const ids = [...new Set(rows.map((row) => row.gameId))];
        const byId = new Map(
          (await fetchGameRecords(ids)).map((record) => [record.id, record.game]),
        );
        if (cancelled) return;
        setGames(ids.map((id) => byId.get(id)).filter((game): game is Game => Boolean(game)));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load recent games. Try again.");
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [limit, tick]);

  return { games, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

// ── Games by id (liked / saved / activity lists) ────────────────────────────
// Liked and saved pages list catalogue games, so ids are mapped back onto the
// catalogue shape: the row from the public projection plus the measured play
// count. A game that no longer resolves (unpublished, deleted) is omitted
// rather than listed as a dead row.

/** Maps game ids onto catalogue games, preserving the input order. */
export async function fetchGamesByIds(ids: string[]): Promise<Game[]> {
  return (await fetchGameRecords(ids)).map((record) => record.game);
}

/** Like {@link fetchGamesByIds}, but keeping each row's id for random access. */
export async function fetchGameRecords(ids: string[]): Promise<Array<{ id: string; game: Game }>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) return [];
  const filter = `id=in.(${unique.map(encodeURIComponent).join(",")})`;
  const [rows, stats] = await Promise.all([
    restGet<GameRecord[]>(
      `games?${filter}&select=id,slug,title,tagline,description,instructions,runtime,playable,is_official,cover_path,published_at,updated_at,categories(slug,name)`,
    ),
    restGet<GameStatRow[]>(`game_stats?select=slug,plays`).catch(() => [] as GameStatRow[]),
  ]);
  const plays = new Map(stats.map((stat) => [stat.slug, stat.plays]));
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        game: {
          slug: row.slug,
          title: row.title,
          tagline: row.tagline,
          description: row.description,
          instructions: row.instructions,
          category: row.categories,
          runtime: row.runtime,
          playable: row.playable,
          plays: plays.get(row.slug) ?? 0,
          isOfficial: row.is_official,
          coverPath: row.cover_path,
          publishedAt: row.published_at,
          updatedAt: row.updated_at,
        } satisfies Game,
      },
    ]),
  );
  return unique.map((id) => byId.get(id)).filter((record) => record !== undefined);
}

// ── Reactive hooks ──────────────────────────────────────────────────────────

export type EngagementState = {
  gameId: string | null;
  liked: boolean;
  saved: boolean;
  likeCount: number | null;
  commentCount: number | null;
  loading: boolean;
  busy: boolean;
  error: string | undefined;
  toggleLike: () => Promise<void>;
  toggleSave: () => Promise<void>;
  refresh: () => void;
};

/**
 * Like/save state plus measured counts for one game slug. Anonymous visitors
 * get counts and `false` states; toggling as one throws the unauthorized error
 * the screen turns into a sign-in nudge.
 */
export function useGameEngagement(slug: string | undefined): EngagementState {
  const [state, setState] = useState({
    gameId: null as string | null,
    liked: false,
    saved: false,
    likeCount: null as number | null,
    commentCount: null as number | null,
    loading: true,
    busy: false,
    error: undefined as string | undefined,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!slug) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    resolveGameId(slug)
      .then(async (gameId) => {
        if (cancelled || !gameId) {
          if (!cancelled) {
            setState((s) => ({ ...s, gameId: null, loading: false }));
          }
          return;
        }
        const [likeCount, commentCount, liked, saved] = await Promise.all([
          fetchLikeCount(gameId).catch(() => null),
          fetchCommentCount(gameId).catch(() => null),
          isLiked(gameId).catch(() => false),
          isSaved(gameId).catch(() => false),
        ]);
        if (!cancelled) {
          setState((s) => ({
            ...s,
            gameId,
            likeCount,
            commentCount,
            liked,
            saved,
            loading: false,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [slug, tick]);

  const toggleLike = useCallback(async () => {
    const gameId = state.gameId;
    if (!gameId || state.busy) return;
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      if (state.liked) {
        await unlikeGame(gameId);
        setState((s) => ({
          ...s,
          liked: false,
          likeCount: s.likeCount === null ? null : Math.max(0, s.likeCount - 1),
        }));
      } else {
        await likeGame(gameId);
        setState((s) => ({
          ...s,
          liked: true,
          likeCount: s.likeCount === null ? null : s.likeCount + 1,
        }));
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Couldn't update the like. Try again.";
      setState((s) => ({ ...s, error: message }));
      throw err;
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  }, [state.gameId, state.busy, state.liked]);

  const toggleSave = useCallback(async () => {
    const gameId = state.gameId;
    if (!gameId || state.busy) return;
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      if (state.saved) {
        await unsaveGame(gameId);
        setState((s) => ({ ...s, saved: false }));
      } else {
        await saveGame(gameId);
        setState((s) => ({ ...s, saved: true }));
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Couldn't update the saved games. Try again.";
      setState((s) => ({ ...s, error: message }));
      throw err;
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  }, [state.gameId, state.busy, state.saved]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { ...state, toggleLike, toggleSave, refresh };
}

export type CommentsState = {
  items: GameComment[];
  count: number | null;
  loading: boolean;
  posting: boolean;
  error: string | undefined;
  post: (body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retry: () => void;
};

/** A game's thread: the visible rows, the measured total, posting and own-delete. */
export function useComments(gameId: string | undefined): CommentsState {
  const [items, setItems] = useState<GameComment[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    Promise.all([fetchComments(gameId), fetchCommentCount(gameId).catch(() => null)])
      .then(([rows, total]) => {
        if (cancelled) return;
        setItems(rows);
        setCount(total ?? rows.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load comments. Try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, tick]);

  const post = useCallback(
    async (body: string) => {
      if (!gameId || posting) return;
      setPosting(true);
      try {
        await postComment(gameId, body);
        const [rows, total] = await Promise.all([
          fetchComments(gameId),
          fetchCommentCount(gameId).catch(() => null),
        ]);
        setItems(rows);
        setCount(total ?? rows.length);
      } catch (err) {
        throw err instanceof ApiError ? err : new ApiError("Couldn't post the comment. Try again.");
      } finally {
        setPosting(false);
      }
    },
    [gameId, posting],
  );

  const remove = useCallback(async (id: string) => {
    await deleteComment(id);
    setItems((rows) => rows.filter((row) => row.id !== id));
    setCount((total) => (total === null ? null : Math.max(0, total - 1)));
  }, []);

  const retry = useCallback(() => setTick((n) => n + 1), []);

  return { items, count, loading, posting, error, post, remove, retry };
}

export type GameListState = {
  games: Game[];
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
};

function useOwnGameIds(kind: "likes" | "saves"): GameListState {
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState<GameListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setGames([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    (kind === "likes" ? listLikedGameIds() : listSavedGameIds())
      .then((ids) => fetchGamesByIds(ids))
      .then((resolved) => {
        if (cancelled) return;
        setGames(resolved);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load games. Try again.");
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kind, tick]);

  // A sign-out mid-list must not leave another player's games on screen: the
  // auth subscription above resets through `anonymous`.
  return { games, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

/** Games the signed-in caller liked, newest first. */
export function useLikedGames(): GameListState {
  return useOwnGameIds("likes");
}

/** Games the signed-in caller saved, newest first. */
export function useSavedGames(): GameListState {
  return useOwnGameIds("saves");
}

export type ActivitySection = {
  likes: Game[];
  saves: Game[];
  comments: Array<GameComment & { gameSlug: string; gameTitle: string }>;
  scores: Array<{ game: Game | null; score: number; createdAt: string }>;
};

/** Recent likes, saves, comments and scores for the activity page. */
export function useActivity(): {
  data: ActivitySection;
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
} {
  const [data, setData] = useState<ActivitySection>({
    likes: [],
    saves: [],
    comments: [],
    scores: [],
  });
  const [status, setStatus] = useState<"anonymous" | "loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setData({ likes: [], saves: [], comments: [], scores: [] });
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    Promise.all([
      listLikedGameIds(5).then((ids) => fetchGamesByIds(ids)),
      listSavedGameIds(5).then((ids) => fetchGamesByIds(ids)),
      listMyComments(5),
      listMyRecentScores(5),
    ])
      .then(async ([likes, saves, comments, scores]) => {
        if (cancelled) return;
        const gameIds = [
          ...comments.map((comment) => comment.gameId),
          ...scores.map((entry) => entry.gameId),
        ];
        const gamesById = new Map(
          (await fetchGameRecords(gameIds)).map((record) => [record.id, record.game]),
        );
        if (cancelled) return;
        setData({
          likes,
          saves,
          comments: comments.map((comment) => {
            const game = gamesById.get(comment.gameId);
            return {
              ...comment,
              gameSlug: game?.slug ?? "",
              gameTitle: game?.title ?? "A game",
            };
          }),
          scores: scores.map((entry) => ({
            game: gamesById.get(entry.gameId) ?? null,
            score: entry.score,
            createdAt: entry.createdAt,
          })),
        });
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load activity. Try again.");
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tick]);

  return { data, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}
