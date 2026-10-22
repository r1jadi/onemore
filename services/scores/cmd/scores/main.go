// Command scores owns score records.
//
// Scores are written only by the game-sessions service completing a session;
// the public API exposes reads plus a personal bests view. A client-supplied
// score is never trusted, which is why there is no "POST /scores" for players.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "scores"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.PublicFunc("GET /api/v1/scores/{scoreID}",
				httpx.NotImplemented(serviceName, "Reading a score"))

			router.AuthenticatedFunc("GET /api/v1/scores/me",
				httpx.NotImplemented(serviceName, "Reading your scores and personal bests"))
		},
	})
}
