import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/social/ProfileView";
import { getUser } from "@/lib/mock";

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
 * Another player's profile. The data is still the prototype's: there is no
 * public profile endpoint yet, and this page is not the signed-in identity —
 * `GET /api/v1/users/me` is, which is what `/profile` reads.
 */
function UserProfile() {
  const { username } = Route.useParams();
  const user = getUser(username);
  return (
    <ProfileView
      user={{
        username: user.username,
        name: user.name,
        bio: user.bio,
        verified: user.verified,
        isFollowing: user.isFollowing,
        stats: { followers: user.followers, following: user.following, played: user.played },
      }}
    />
  );
}
