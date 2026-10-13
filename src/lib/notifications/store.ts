/**
 * Real in-app notifications backed by `public.notifications` through the
 * Supabase Data API. RLS scopes every read and write to `auth.uid()`, so a
 * caller can only ever see their own inbox and guests see nothing.
 *
 * No mock rows: an empty inbox is an empty state, a failure is a retryable
 * error, and the unread badge is the count of rows with `read_at IS NULL`.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export type NotificationKind = "follow" | "comment" | "like" | "score" | "moderation" | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError && error.status === 401) {
    return new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  return new ApiError("Couldn't load notifications. Try again.", { code: "notifications_failed" });
}

export async function fetchNotifications(limit = 50): Promise<AppNotification[]> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    const rows = await restGet<Row[]>(
      `notifications?select=id,kind,payload,read_at,created_at&order=created_at.desc&limit=${limit}`,
      token,
    );
    return rows.map(toNotification);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function fetchUnreadCount(): Promise<number> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return 0;
  try {
    const rows = await restGet<Array<{ id: string }>>(
      "notifications?select=id&read_at=is.null&limit=100",
      token,
    );
    return rows.length;
  } catch {
    // A failed badge read is not a badge: callers render no count and the
    // page itself reports the failure with a retry.
    return 0;
  }
}

export async function markAllRead(): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate("notifications?read_at=is.null", "PATCH", token, {
      read_at: new Date().toISOString(),
    });
  } catch (error) {
    throw toApiError(error);
  }
}

export async function markRead(id: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate(`notifications?id=eq.${encodeURIComponent(id)}`, "PATCH", token, {
      read_at: new Date().toISOString(),
    });
  } catch (error) {
    throw toApiError(error);
  }
}

export type NotificationsState =
  | { status: "anonymous" }
  | { status: "loading" }
  | { status: "ready"; items: AppNotification[] }
  | { status: "error"; error: ApiError };

export function useNotifications(): NotificationsState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<NotificationsState>(() =>
    getAuthState().status === "authenticated" ? { status: "loading" } : { status: "anonymous" },
  );

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setState({ status: "anonymous" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchNotifications()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof ApiError ? error : new ApiError("Couldn't load notifications."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(
    () =>
      subscribeToAuth(() => {
        const auth = getAuthState();
        if (auth.status !== "authenticated") setState({ status: "anonymous" });
        else setAttempt((n) => n + 1);
      }),
    [],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry } as NotificationsState & { retry: () => void };
}

/** Reactive unread badge count: zero while anonymous, loading or failed. */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchUnreadCount().then((value) => {
      if (!cancelled) setCount(value);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(
    () =>
      subscribeToAuth(() => {
        const auth = getAuthState();
        if (auth.status !== "authenticated") setCount(0);
        else setTick((n) => n + 1);
      }),
    [],
  );

  return count;
}

/** Human-readable line for a notification row. Never invents actor names. */
export function describeNotification(item: AppNotification): string {
  const payload = item.payload;
  const text = typeof payload["text"] === "string" ? payload["text"] : "";
  switch (item.kind) {
    case "follow":
      return text !== "" ? text : "started following you";
    case "comment":
      return text !== "" ? text : "commented on your score";
    case "like":
      return text !== "" ? text : "liked your score";
    case "score":
      return text !== "" ? text : "beat your score";
    case "moderation":
      return text !== "" ? text : "An update about your content";
    case "system":
    default:
      return text !== "" ? text : "An update from onemore";
  }
}
