import { createRouter } from "@tanstack/react-router";

import { getQueryClient } from "./lib/query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = getQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering or touching a link starts loading that page's code and data, so
    // most taps land on a screen that is already filled in.
    defaultPreload: "intent",
    // The query cache decides freshness; the router always asks it.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
