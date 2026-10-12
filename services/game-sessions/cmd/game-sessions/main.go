// Command game-sessions owns play sessions.
//
// A session is the server's record of one play attempt: the database chooses the
// seed and keeps the timeline, and the only way a score comes into existence is a
// finished run being replayed against the rules its session was issued under.
//
// This binary is the service on its own, for local development. The deployed
// entrypoint serves the same routes from `services/main.go`, because Vercel's Go
// preset gives a service root three entrypoint names and all three are taken —
// see docs/deployment/vercel.md.
package main

import (
	"github.com/r1jadi/onemore/services/game-sessions"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(gamesessions.Options())
}
