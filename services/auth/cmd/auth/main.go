// Command auth runs the Auth service: the session lifecycle on top of Supabase
// Auth.
//
// Supabase Auth is the identity provider — it stores credentials, enforces the
// password policy and issues access and refresh tokens. This process never sees a
// password beyond passing it to Supabase, and never holds the secret key: it
// calls Supabase as the caller, with the publishable key, so Row Level Security
// decides what is visible.
//
// The wiring lives in the package (services/auth) rather than here so the tests
// exercise exactly the service this binary serves.
package main

import (
	"github.com/r1jadi/onemore/services/auth"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(auth.Options())
}
