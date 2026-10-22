// Command moderation owns reports and moderation actions.
//
// Reporting is open to signed-in users; reading the queue and acting on it
// requires an allowlisted administrator email, enforced by the platform
// middleware. Moderators never gain read access to secrets — only to the
// reported content.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "moderation"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AuthenticatedFunc("POST /api/v1/moderation/reports",
				httpx.NotImplemented(serviceName, "Reporting content"))

			router.ModeratorFunc("GET /api/v1/moderation/reports",
				httpx.NotImplemented(serviceName, "Reading the report queue"))

			router.ModeratorFunc("POST /api/v1/moderation/actions",
				httpx.NotImplemented(serviceName, "Applying a moderation action"))

			router.ModeratorFunc("POST /api/v1/moderation/games/{gameID}/review",
				httpx.NotImplemented(serviceName, "Reviewing a game submission"))
		},
	})
}
