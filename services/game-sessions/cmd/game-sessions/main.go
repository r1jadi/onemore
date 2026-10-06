// Command game-sessions owns play sessions.
//
// A session is the server's record of one play attempt. Scores are only
// accepted through a session, so a client cannot invent a run: the service owns
// the seed, the start time and the end state.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "game-sessions"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AuthenticatedFunc("POST /api/v1/sessions",
				httpx.NotImplemented(serviceName, "Starting a play session"))

			router.AuthenticatedFunc("GET /api/v1/sessions/{sessionID}",
				httpx.NotImplemented(serviceName, "Reading a play session"))

			// The only door to the scores service: the session must belong to
			// the caller and must still be open.
			router.AuthenticatedFunc("POST /api/v1/sessions/{sessionID}/complete",
				httpx.NotImplemented(serviceName, "Completing a play session"))
		},
	})
}
