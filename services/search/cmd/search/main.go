// Command search owns game and player search.
//
// Search runs against a dedicated index (Postgres full-text first, a search
// engine only if it earns its place). Queries are parameterised only — no
// string-built SQL — and result sets are bounded.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "search"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.PublicFunc("GET /api/v1/search",
				httpx.NotImplemented(serviceName, "Searching games, creators and players"))

			router.PublicFunc("GET /api/v1/search/suggest",
				httpx.NotImplemented(serviceName, "Suggesting search terms"))
		},
	})
}
