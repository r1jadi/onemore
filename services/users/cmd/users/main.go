// Command users owns player profiles.
//
// The authenticated user id always comes from the verified token, never from
// the request body or path: `/me` routes are the only way to address "yourself".
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "users"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AuthenticatedFunc("GET /api/v1/users/me",
				httpx.NotImplemented(serviceName, "Reading the signed-in profile"))

			router.AuthenticatedFunc("PATCH /api/v1/users/me",
				httpx.NotImplemented(serviceName, "Updating the signed-in profile"))

			router.AuthenticatedFunc("POST /api/v1/users/me/onboarding",
				httpx.NotImplemented(serviceName, "Saving onboarding preferences"))

			// Public profiles expose only published fields — the handler must
			// never serialise the full row.
			router.PublicFunc("GET /api/v1/users/{userID}",
				httpx.NotImplemented(serviceName, "Reading a public profile"))
		},
	})
}
