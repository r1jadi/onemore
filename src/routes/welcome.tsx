import { createFileRoute, Link } from "@tanstack/react-router";
import { GameArt } from "@/components/game/GameArt";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/welcome")({
  head: () => seo("Welcome", "onemore is a social feed of short, playable games."),
  component: Welcome,
});

function Welcome() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-2 gap-2 p-2 opacity-70 md:grid-cols-4">
          {(
            [
              "stack-10",
              "dont-touch-the-black",
              "color-merge",
              "memory-flash",
              "one-move",
              "dont-break-the-chain",
              "7-second",
              "stack-10",
            ] as const
          ).map((id, i) => (
            <GameArt key={i} id={id} className="rounded-2xl border border-glass-border" />
          ))}
        </div>
        <div className="absolute inset-0 scrim-bottom" />
      </div>
      <div className="enter relative mx-auto w-full max-w-sm px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Logo />
        <h1 className="mt-4 text-3xl font-semibold leading-tight">
          Play a game.
          <br />
          Then one more.
        </h1>
        <p className="mt-2 text-muted-foreground">Short games, real scores, and friends to beat.</p>
        <div className="mt-8 space-y-2">
          <Button asChild variant="play" size="xl" className="w-full">
            <Link to="/onboarding">Get started</Link>
          </Button>
          <Button asChild variant="secondary" size="xl" className="w-full">
            <Link to="/login">I have an account</Link>
          </Button>
          <Link
            to="/"
            className="block py-2 text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Browse without an account
          </Link>
        </div>
      </div>
    </div>
  );
}
