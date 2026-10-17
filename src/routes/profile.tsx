import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, ErrorState } from "@/components/common";
import { ProfileView, type ProfileHeader } from "@/components/social/ProfileView";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { useFollowCounts, type FollowCountsState } from "@/lib/social/follows";
import {
  avatarUrl,
  refreshProfile,
  useProfile,
  type Profile,
  type ProfileState,
} from "@/lib/users/profile";

export const Route = createFileRoute("/profile")({
  head: () => seo("Your profile", "Your scores, achievements, saved and recently played games."),
  component: OwnProfile,
});

/**
 * The signed-in user's own profile. The identity comes from
 * `GET /api/v1/users/me`, which resolves it from the verified token — this screen
 * never names a user, so it cannot be pointed at somebody else's row.
 */
function OwnProfile() {
  const state = useProfile();
  const profile = state.status === "ready" ? state.profile : undefined;
  // Counts are keyed by the profile the API resolved from the token, never by
  // a client-supplied id; they refresh after every follow or unfollow.
  const counts = useFollowCounts(profile?.id);

  return (
    <ProfileView
      self
      loading={!profile && (state.status === "idle" || state.status === "loading")}
      user={profile ? header(profile, counts) : { username: "", name: "" }}
      fallback={profile ? undefined : absent(state)}
    />
  );
}

/** The API's profile, mapped onto the fields the view draws. */
function header(profile: Profile, counts: FollowCountsState): ProfileHeader {
  return {
    username: profile.username,
    name: profile.displayName,
    bio: profile.bio,
    avatarSrc: avatarUrl(profile),
    stats: counts.counts,
    statsLoading: counts.status === "loading" || counts.status === "idle",
    statsError: counts.error,
    onRetryStats: counts.reload,
  };
}

/**
 * What to draw when there is no profile to draw. Each of these is a state the
 * account can genuinely be in, so none of them is answered with invented data.
 */
function absent(state: ProfileState) {
  switch (state.status) {
    case "anonymous":
      return (
        <EmptyState
          title="Sign in to see your profile"
          body="Your profile, scores and saves belong to your account."
          action={
            <Button asChild>
              <Link to="/login">Log in</Link>
            </Button>
          }
        />
      );
    case "missing":
      return (
        <EmptyState
          title="No profile yet"
          body="This account has no profile stored. A profile is created with the account, so try again in a moment."
          action={
            <Button variant="secondary" onClick={() => void refreshProfile()}>
              Try again
            </Button>
          }
        />
      );
    case "error":
      return (
        <ErrorState
          title="Couldn't load your profile"
          body={state.error.message}
          onRetry={() => void refreshProfile()}
        />
      );
    default:
      // Loading: the view draws its own skeleton for this.
      return null;
  }
}
