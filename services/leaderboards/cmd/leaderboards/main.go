// Command leaderboards owns global and friends leaderboards.
//
// Boards are projections over scores, never editable through the API. Private
// boards (friends, cohort) are computed from the caller's verified identity.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "leaderboards"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.PublicFunc("GET /api/v1/leaderboards",
				httpx.NotImplemented(serviceName, "Listing leaderboards"))

			router.PublicFunc("GET /api/v1/leaderboards/{boardID}",
				httpx.NotImplemented(serviceName, "Reading a leaderboard"))

			router.OptionalAuth("GET /api/v1/leaderboards/{boardID}/me",
				httpx.NotImplemented(serviceName, "Reading your rank on a leaderboard"))
		},
	})
}
