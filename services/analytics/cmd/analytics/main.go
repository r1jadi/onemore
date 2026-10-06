// Command analytics owns product analytics and dashboards.
//
// Events are appended, never trusted for authorization, and are pseudonymised:
// the user id attached to an event comes from the verified token, and free-text
// client payloads are validated against an allowlist of event names.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "analytics"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.OptionalAuth("POST /api/v1/analytics/events",
				httpx.NotImplemented(serviceName, "Recording an analytics event"))

			router.AdminFunc("GET /api/v1/analytics/summary",
				httpx.NotImplemented(serviceName, "Reading the analytics summary"))
		},
	})
}
