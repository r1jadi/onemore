// Command games owns the game catalogue and game metadata.
//
// Published game metadata is public; anything a creator sends is validated
// against the same schema the database enforces, and the owner id comes from the
// token, never from the payload (no mass assignment).
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "games"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.PublicFunc("GET /api/v1/games",
				httpx.NotImplemented(serviceName, "Browsing the catalogue"))

			router.PublicFunc("GET /api/v1/games/{gameID}",
				httpx.NotImplemented(serviceName, "Reading a game"))

			router.AuthenticatedFunc("POST /api/v1/games",
				httpx.NotImplemented(serviceName, "Creating a game"))

			router.AuthenticatedFunc("PATCH /api/v1/games/{gameID}",
				httpx.NotImplemented(serviceName, "Updating an owned game"))

			router.AuthenticatedFunc("POST /api/v1/games/{gameID}/publish",
				httpx.NotImplemented(serviceName, "Submitting a game for review"))
		},
	})
}
