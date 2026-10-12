// Command games runs the Games service locally.
//
// It is the developer's entrypoint — `go run ./games/cmd/games` from
// `services/` — and the deployment entrypoint is services/main.go, because
// Vercel's Go framework preset only recognises `main.go`, `cmd/api/main.go` and
// `cmd/server/main.go` at the service root, and the latter two are already spoken
// for (auth owns `cmd/server`, users owns `cmd/api`). Both files are one line of
// `servicekit.MustRun(games.Options())`, so the local binary and the deployment
// cannot drift into different wiring.
//
// See services/games/games.go for the routes and docs/deployment/vercel.md for
// the topology.
package main

import (
	"github.com/r1jadi/onemore/services/games"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(games.Options())
}
