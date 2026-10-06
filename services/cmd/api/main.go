// Command api is the Vercel entrypoint for the API gateway.
//
// Vercel's Go runtime does not keep a container with a fixed `:8080` listener
// alive: it builds one package of the service and runs the resulting binary as
// the deployment's server, handing it the port to bind in `PORT` (Vercel routes
// every request of the service to that process). `config.Load` honours `PORT`,
// and `HTTP_ADDR` stays the explicit override, so the same binary serves a local
// shell, a container and Vercel without a deployment-specific file.
//
// The path is not arbitrary: Vercel detects `main.go`, `cmd/api/main.go` or
// `cmd/server/main.go` at the service root, and `vercel.json` names this one.
// The service wiring is shared with cmd/gateway (see services/gateway), so the
// two entrypoints cannot drift into different security postures.
//
// See docs/deployment/vercel.md for the routing, the required environment
// variables and what has to be verified after a deployment.
package main

import (
	"github.com/r1jadi/onemore/services/gateway"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(gateway.Options())
}
