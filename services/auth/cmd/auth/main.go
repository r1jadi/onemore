// Command auth owns session lifecycle on top of Supabase Auth.
//
// Supabase Auth is the identity provider: it stores credentials, issues access
// tokens and handles password reset and email verification. This service never
// sees a password — it exchanges a Supabase session for application session
// state and revokes sessions.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "auth"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			// Anonymous callers present a Supabase session and receive the
			// application session view (roles, onboarding state).
			router.PublicFunc("POST /api/v1/auth/session",
				httpx.NotImplemented(serviceName, "Exchanging a Supabase session"))

			router.AuthenticatedFunc("GET /api/v1/auth/session",
				httpx.NotImplemented(serviceName, "Reading the current session"))

			router.AuthenticatedFunc("POST /api/v1/auth/sign-out",
				httpx.NotImplemented(serviceName, "Signing out"))
		},
	})
}
