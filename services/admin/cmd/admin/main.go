// Command admin owns the operations API behind the admin dashboard.
//
// Every route requires the admin role, verified from the token by the platform
// middleware and re-checked by Row Level Security. The dashboard hides these
// screens, but hiding a screen is not a control — this route group is.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "admin"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AdminFunc("GET /api/v1/admin/users",
				httpx.NotImplemented(serviceName, "Listing users"))

			router.AdminFunc("PATCH /api/v1/admin/users/{userID}",
				httpx.NotImplemented(serviceName, "Updating a user"))

			router.AdminFunc("GET /api/v1/admin/games",
				httpx.NotImplemented(serviceName, "Listing games for moderation"))

			router.AdminFunc("GET /api/v1/admin/system/services",
				httpx.NotImplemented(serviceName, "Reading platform service status"))

			router.ModeratorFunc("GET /api/v1/admin/comments",
				httpx.NotImplemented(serviceName, "Listing comments for moderation"))
		},
	})
}
