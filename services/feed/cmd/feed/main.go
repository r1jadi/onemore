// Command feed owns the personalised game feed shown by the web app.
//
// Anonymous callers get the public ranking; signed-in callers get a feed
// derived from their verified identity. The user id is never a parameter.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "feed"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.OptionalAuth("GET /api/v1/feed",
				httpx.NotImplemented(serviceName, "Reading the game feed"))

			router.AuthenticatedFunc("GET /api/v1/feed/following",
				httpx.NotImplemented(serviceName, "Reading the following feed"))
		},
	})
}
