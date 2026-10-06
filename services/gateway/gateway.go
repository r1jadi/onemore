// Package gateway defines the public API gateway as a service definition.
//
// It terminates request-id generation, panic recovery, security headers, CORS,
// rate limiting and body limits, then forwards `/api/v1/<group>` to the service
// that owns that group (services/internal/apiroutes). Services behind it repeat
// authentication locally, so a routing mistake here cannot hand out access.
//
// The definition lives in a package rather than in a main so the two entrypoints
// this repository ships — cmd/gateway (a long-running process) and cmd/api
// (Vercel's Go runtime) — serve exactly the same service instead of drifting
// apart. Deploy: one process, no database credentials, no service role key.
package gateway

import (
	"log/slog"
	"net/http"

	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/packages/go/platform/version"
	"github.com/r1jadi/onemore/services/gateway/internal/proxy"
	"github.com/r1jadi/onemore/services/internal/apiroutes"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

// Name is the service name used in logs and configuration validation.
const Name = "gateway"

// Options returns the wiring every gateway entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,

		// The reverse proxy is installed inside the standard middleware chain,
		// so proxied requests still get request ids, logging and headers.
		ExtraHandlers: func(cfg *config.Config, logger *slog.Logger) []httpx.Middleware {
			return []httpx.Middleware{proxy.New(cfg, logger).Middleware()}
		},

		Register: func(router *httpx.Router) {
			// Version discovery: clients and probes can confirm which API
			// version this deployment speaks without touching a service.
			router.PublicFunc("GET "+apiroutes.BasePath, func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]any{
					"apiVersion": apiroutes.Version,
					"version":    version.Version,
					"commit":     version.Commit,
				})
			})
		},
	}
}
