import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/social/ProfileView";
import { me } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/profile")({
  head: () => seo("Your profile", "Your scores, achievements, saved and recently played games."),
  component: () => <ProfileView user={me} self />,
});
