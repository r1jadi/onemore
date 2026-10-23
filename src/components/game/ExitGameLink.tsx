import { Link, useRouter } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

/**
 * The way out of a game and back to its info page.
 *
 * The play screen is pushed onto the info page, so the usual exit is a step back
 * through real history: the info page is one entry, not two, and Back from it
 * continues to wherever the player came from. A link that pushed the info page
 * again would leave the game behind it — Back would return to the screen the
 * player just left.
 *
 * A play screen opened directly (a shared link, a reload) has no such entry
 * behind it, so the fallback navigates in place instead. Stepping back there
 * would leave the app rather than reach the game.
 *
 * Props are passed through to the link because these sit inside `<Button asChild>`,
 * which supplies the button's classes; dropping them would leave a bare anchor.
 */
export function ExitGameLink({
  slug,
  children,
  ...rest
}: { slug: string; children: ReactNode } & Omit<ComponentProps<"a">, "href" | "onClick">) {
  const router = useRouter();
  // TanStack numbers its own history entries; a direct load is entry zero.
  const cameFromThisApp = (router.history.location.state?.__TSR_index ?? 0) > 0;

  return (
    <Link
      {...rest}
      to="/games/$id"
      params={{ id: slug }}
      replace
      onClick={(event) => {
        if (!cameFromThisApp) return;
        event.preventDefault();
        router.history.back();
      }}
    >
      {children}
    </Link>
  );
}
