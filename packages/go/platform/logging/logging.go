// Package logging provides the structured logger every service uses. Logs are
// JSON in staging/production so they can be shipped and queried, text in
// development for readability.
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/r1jadi/onemore/packages/go/platform/config"
)

type ctxKey int

const loggerKey ctxKey = 1

// New builds the root logger for a service.
func New(cfg *config.Config) *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(cfg.Logging.Level) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	opts := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if cfg.Logging.Format == "text" {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	return slog.New(handler).With(
		slog.String("service", cfg.Service),
		slog.String("environment", string(cfg.Environment)),
	)
}

// WithLogger attaches a logger to a context.
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey, logger)
}

// FromContext returns the request logger, falling back to the default logger so
// callers never have to nil-check.
func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey).(*slog.Logger); ok && logger != nil {
		return logger
	}
	return slog.Default()
}

// Redacted returns a placeholder for a sensitive value. Use it instead of
// logging tokens, keys or personal data.
func Redacted() string { return "[redacted]" }

// RedactHeaders copies headers with credential-bearing values replaced.
func RedactHeaders(headers map[string][]string) map[string][]string {
	out := make(map[string][]string, len(headers))
	for key, values := range headers {
		switch strings.ToLower(key) {
		case "authorization", "cookie", "set-cookie", "x-api-key", "apikey", "proxy-authorization":
			out[key] = []string{Redacted()}
		default:
			out[key] = values
		}
	}
	return out
}
