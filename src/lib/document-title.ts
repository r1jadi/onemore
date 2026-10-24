import { useEffect } from "react";

import { SITE_NAME } from "@/lib/seo";

/**
 * Sets the tab title once a page knows its real name.
 *
 * A route's `head` runs before its data arrives, so a game page can only title
 * itself from the URL. When the record loads, this replaces that guess with the
 * catalogue's own title (or says the page does not exist). Passing `undefined`
 * leaves the route's title alone, which is what a page still loading wants.
 */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title === undefined || typeof document === "undefined") return;
    document.title = `${title} — ${SITE_NAME}`;
  }, [title]);
}
