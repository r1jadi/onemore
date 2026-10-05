import { createFileRoute, Link } from "@tanstack/react-router";
import { ListSkeleton, Page, PageHeader, useMockLoad } from "@/components/common";
import { GameThumb } from "@/components/game/GameCard";
import { fmt, games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/activity")({
  head: () => seo("Activity", "Your recent plays, scores, likes and comments."),
  component: Activity,
});

const groups = [
  { label: "Today", items: [{ g: 0, text: "Scored", score: 2140 }, { g: 2, text: "Scored", score: 148 }, { g: 1, text: "Liked" }] },
  { label: "This week", items: [{ g: 5, text: "Commented on" }, { g: 4, text: "Scored", score: 17 }, { g: 3, text: "Saved" }] },
];

function Activity() {
  const loading = useMockLoad();
  return (
    <Page>
      <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
      {loading ? <ListSkeleton /> : groups.map((grp) => (
        <section key={grp.label} className="mb-4">
          <h2 className="px-4 py-2 text-xs font-medium text-muted-foreground md:px-0">{grp.label}</h2>
          <ul>
            {grp.items.map((it, i) => {
              const g = games[it.g];
              return (
                <li key={i} className="enter">
                  <Link to="/games/$id" params={{ id: g.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface md:rounded-lg md:px-2">
                    <GameThumb game={g} className="size-11" />
                    <span className="flex-1 text-sm">{it.text} <span className="font-medium">{g.title}</span></span>
                    {it.score !== undefined && <span className="font-mono text-sm font-semibold tabular">{fmt(it.score)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Page>
  );
}
