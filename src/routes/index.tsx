import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => seo("For You", "Swipe through playable games. Play, score, and swipe to the next one."),
  component: () => <Feed tab="for-you" items={games} />,
});
