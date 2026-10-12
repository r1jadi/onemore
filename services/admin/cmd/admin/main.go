// Command admin owns the operations API behind the admin dashboard.
//
// Every route requires a verified token, a role claim strong enough for the
// operation, and — the check that actually decides it — a matching row in
// `public.user_roles`, read by the database with the caller's own token. The
// dashboard hides these screens, but hiding a screen is not a control: this route
// group is.
//
// This binary is the service on its own, for local development. The deployed
// entrypoint serves the same routes from `services/main.go`, because Vercel's Go
// preset gives a service root three entrypoint names and all three are taken —
// see docs/deployment/vercel.md.
package main

import (
	"github.com/r1jadi/onemore/services/admin"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(admin.Options())
}
