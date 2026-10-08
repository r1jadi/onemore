// Package servicekit is the one place a service boots from: configuration,
// logging, authentication, rate limiting, health probes and graceful shutdown.
//
// Every service main stays a few lines long and cannot drift into a subtly
// different security posture than its neighbours.
package servicekit

import (
	"log/slog"
	"os"

	"github.com/r1jadi/onemore/packages/go/platform/authn"
	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/packages/go/platform/logging"
	"github.com/r1jadi/onemore/packages/go/platform/version"
)

// Options describes a service.
type Options struct {
	// Name is the service name used in logs, configuration validation and the
	// SERVICE_NAME default.
	Name string
	// Register mounts this service's routes. Endpoints that are part of the
	// published contract but not implemented yet must use httpx.NotImplemented
	// so clients receive 501 instead of an accidental 404.
	Register func(router *httpx.Router)
	// RegisterWith is Register with the resolved dependencies, for a service
	// whose handlers need them: the auth service calls Supabase Auth and verifies
	// a token presented in a request body. It runs after Register.
	RegisterWith func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, verifier *authn.Verifier)
	// Checkers add readiness probes for external dependencies.
	Checkers []httpx.Checker
	// ExtraHandlers builds middleware that runs inside the standard chain. It
	// receives the resolved configuration and logger because it is called after
	// configuration loading; the gateway uses it to install its reverse proxy.
	ExtraHandlers func(cfg *config.Config, logger *slog.Logger) []httpx.Middleware
	// ExtraLimiters are per-service token buckets (the auth service meters its
	// credential endpoints separately from the shared budget). Run cleans them
	// up with the shared limiter.
	ExtraLimiters []*httpx.RateLimiter
}

// Service is a fully wired service that has not started listening yet.
type Service struct {
	opts   Options
	config *config.Config
	logger *slog.Logger
	router *httpx.Router
	health *httpx.Health
	server httpx.ServerOptions
}

// New loads configuration and assembles the service. It terminates the process
// when the configuration is invalid, because a service that cannot be
// configured securely must not start.
func New(opts Options) *Service {
	cfg := config.MustLoad(opts.Name)
	logger := logging.New(cfg)

	verifier := buildVerifier(cfg, logger)
	limiter := httpx.NewRateLimiter(cfg.HTTP.RateLimit)

	health := httpx.NewHealth(version.Version)
	for _, checker := range opts.Checkers {
		health.Register(checker)
	}

	router := httpx.NewRouter(httpx.RouterOptions{
		Config:   cfg,
		Verifier: verifier,
		Logger:   logger,
		Limiter:  limiter,
	})

	// Registration is pure: mount the standard probes and the service routes
	// now, so tests can exercise the exact routing the binary serves.
	health.RegisterHealthRoutes(router.Mux())
	if opts.Register != nil {
		opts.Register(router)
	}
	if opts.RegisterWith != nil {
		opts.RegisterWith(router, cfg, logger, verifier)
	}

	var extra []httpx.Middleware
	if opts.ExtraHandlers != nil {
		extra = opts.ExtraHandlers(cfg, logger)
	}

	return &Service{
		opts:   opts,
		config: cfg,
		logger: logger,
		router: router,
		health: health,
		server: httpx.ServerOptions{
			Config:        cfg,
			Router:        router,
			Health:        health,
			Logger:        logger,
			Limiter:       limiter,
			ExtraLimiters: opts.ExtraLimiters,
			ExtraHandlers: extra,
		},
	}
}

// Logger exposes the service logger.
func (s *Service) Logger() *slog.Logger { return s.logger }

// Router exposes the router for tests and late route registration.
func (s *Service) Router() *httpx.Router { return s.router }

// Health exposes the readiness registry.
func (s *Service) Health() *httpx.Health { return s.health }

// Config exposes the resolved configuration.
func (s *Service) Config() *config.Config { return s.config }

// Run serves the wired service until a termination signal arrives. Routes and
// probes are already registered by New.
func (s *Service) Run() error {
	return httpx.Run(s.server)
}

// MustRun boots the service and only returns by terminating the process.
func MustRun(opts Options) {
	service := New(opts)
	if err := service.Run(); err != nil {
		service.logger.Error("service stopped", slog.Any("error", err))
		// A non-zero exit is what tells an orchestrator to restart the task.
		os.Exit(1)
	}
}

// buildVerifier returns nil when the deployment has no Supabase auth material
// yet. Authenticated routes then fail closed with 503 instead of silently
// admitting anonymous callers (see authn.Middleware).
func buildVerifier(cfg *config.Config, logger *slog.Logger) *authn.Verifier {
	if !cfg.HasAuthMaterial() {
		logger.Warn("no Supabase auth material configured; authenticated routes answer 503 until SUPABASE_URL or SUPABASE_JWKS_URL is set")
		return nil
	}
	verifier, err := authn.NewVerifier(cfg)
	if err != nil {
		logger.Error("invalid auth configuration", slog.Any("error", err))
		os.Exit(1)
	}
	return verifier
}
