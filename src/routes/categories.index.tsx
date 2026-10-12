import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, Calendar, Gamepad2, Puzzle, Swords, Type, Zap, Lightbulb } from "lucide-react";
import { Page, PageHeader } from "@/components/common";
import { categories } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/categories/")({
  head: () => seo("Categories", "Browse every game category on onemore."),
  component: Categories,
});

const icons: Record<string, typeof Puzzle> = {
  puzzle: Puzzle,
  arcade: Gamepad2,
  logic: Lightbulb,
  reaction: Zap,
  memory: Brain,
  daily: Calendar,
  word: Type,
  strategy: Swords,
};

function Categories() {
  return (
    <Page>
      <PageHeader back title="Categories" subtitle="Every kind of quick game." />
      <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-0">
        {categories.map((c) => {
          const Icon = icons[c.slug] ?? Puzzle;
          return (
            <Link
              key={c.slug}
              to="/categories/$slug"
              params={{ slug: c.slug }}
              className="press enter flex flex-col gap-6 rounded-xl border border-border bg-surface p-4 hover:bg-surface-2"
            >
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground tabular">{c.count} games</p>
              </div>
            </Link>
          );
        })}
      </div>
    </Page>
  );
}
