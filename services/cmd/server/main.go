// Command server is the Vercel entrypoint for the Auth service.
//
// Vercel's Go framework preset detects exactly three entrypoints — main.go,
// cmd/api/main.go and cmd/server/main.go — and the gateway already owns
// cmd/api/main.go. `cmd/server` is the remaining detected name, so the Auth
// service mounts here.
//
// The body is the same one line the gateway's entrypoint uses: the service is
// defined in services/auth, and this file only names it. There is no second
// implementation to drift — `go run ./auth/cmd/auth`, the container image built
// from Dockerfile.vercel, and this deployment entrypoint all call
// servicekit.MustRun(auth.Options()).
//
// See docs/deployment/vercel.md for the routing, and services/auth/README.md for
// the endpoints and the environment it needs.
package main

import (
	"github.com/r1jadi/onemore/services/auth"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(auth.Options())
}
