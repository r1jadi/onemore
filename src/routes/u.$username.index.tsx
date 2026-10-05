import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/social/ProfileView";
import { getUser } from "@/lib/mock";

export const Route = createFileRoute("/u/$username/")({
  head: ({ params }) => ({ meta: [{ title: `@${params.username} — onemore` }, { name: "description", content: `Scores and games played by @${params.username}.` }, { property: "og:title", content: `@${params.username} on onemore` }, { property: "og:description", content: `Scores and games played by @${params.username}.` }] }),
  component: UserProfile,
});

function UserProfile() {
  const { username } = Route.useParams();
  return <ProfileView user={getUser(username)} />;
}
