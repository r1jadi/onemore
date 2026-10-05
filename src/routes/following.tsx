import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/following")({
  head: () => seo("Following", "Games played and made by people you follow."),
  component: () => <Feed tab="following" items={[games[2], games[0], games[5]]} />,
});
