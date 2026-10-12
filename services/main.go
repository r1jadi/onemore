// Command services is the Games service's Vercel deployment entrypoint.
//
// Vercel's Go framework preset builds a service from a root `go.mod` plus one of
// exactly three entrypoint names — `main.go`, `cmd/api/main.go`,
// `cmd/server/main.go`. Auth owns `cmd/server` and users owns `cmd/api`, so the
// remaining slot is this file; the name is Vercel's fixed list, not a description
// of what runs here. `services/games/cmd/games` is the same wiring for local
// development, so the two cannot diverge.
//
// It is registered as the `games` service in vercel.json with `"root":
// "services/"` and `"entrypoint": "main.go"`. See docs/deployment/vercel.md.
package main

import (
	"github.com/r1jadi/onemore/services/games"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(games.Options())
}
