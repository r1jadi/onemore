import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common";
import { ProfileView } from "@/components/social/ProfileView";
import { listBlockedIds } from "@/lib/settings/blocked";
import { fetchProfileByUsername, getFollowCounts } from "@/lib/social/follows";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/u/$username/")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — onemore` },
      { name: "description", content: `Scores and games played by @${params.username}.` },
      { property: "og:title", content: `@${params.username} on onemore` },
      { property: "og:description", content: `Scores and games played by @${params.username}.` },
    ],
  }),
  component: UserProfile,
});

/**
 * Another player's public profile, read from the public projection. No fixture
 * data: a missing account is a not-found state, a blocked account is hidden,
 * and counts come from the real follow graph.
 */
function UserProfile() {
  const { username } = Route.useParams();
  const [state, setState] = useState<
    | { status: "loading" }
    | {
        status: "ready";
        userId: string;
        name: string;
        bio?: string;
        counts: { followers: number; following: number };
      }
    | { status: "not-found" }
    | { status: "blocked" }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const profile = await fetchProfileByUsername(username);
      if (cancelled) return;
      if (!profile) {
        setState({ status: "not-found" });
        return;
      }
      const blocked = await listBlockedIds();
      if (!cancelled && blocked.has(profile.id)) {
        setState({ status: "blocked" });
        return;
      }
      const counts = await getFollowCounts(profile.id);
      if (!cancelled) {
        setState({
          status: "ready",
          userId: profile.id,
          name: profile.display_name,
          bio: profile.bio ?? undefined,
          counts,
        });
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Couldn't load this profile.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (state.status === "loading") {
    return <ProfileView user={{ username, name: username }} loading />;
  }
  if (state.status === "not-found") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={<EmptyState title="Account not found" body={`@${username} doesn't exist.`} />}
      />
    );
  }
  if (state.status === "blocked") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={<EmptyState title="Not available" body="This profile isn't available." />}
      />
    );
  }
  if (state.status === "error") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={
          <ErrorState
            title="Couldn't load this profile"
            body={state.message}
            onRetry={() => window.location.reload()}
          />
        }
      />
    );
  }

  return (
    <ProfileView
      user={{
        username,
        name: state.name,
        bio: state.bio,
        userId: state.userId,
        stats: { followers: state.counts.followers, following: state.counts.following, played: 0 },
        hidePlayed: true,
      }}
    />
  );
}

export function UserProfileRetry() {
  return <Button onClick={() => window.location.reload()}>Retry</Button>;
}
