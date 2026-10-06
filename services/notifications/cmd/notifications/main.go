// Command notifications owns in-app and push notifications.
//
// Reads and writes are scoped to the verified user: there is no parameter that
// selects another recipient. Delivery providers (email, push) are configured
// server-side only.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "notifications"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AuthenticatedFunc("GET /api/v1/notifications",
				httpx.NotImplemented(serviceName, "Listing notifications"))

			router.AuthenticatedFunc("POST /api/v1/notifications/read",
				httpx.NotImplemented(serviceName, "Marking notifications as read"))

			router.AuthenticatedFunc("POST /api/v1/notifications/devices",
				httpx.NotImplemented(serviceName, "Registering a push device"))
		},
	})
}
