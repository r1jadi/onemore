package httpx

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// Checker reports dependency health for /readyz. A service registers one
// checker per external dependency (database, upstream service, cache).
type Checker interface {
	Name() string
	Check(ctx context.Context) error
}

// CheckerFunc adapts a function to the Checker interface.
type CheckerFunc struct {
	CheckerName string
	Fn          func(ctx context.Context) error
}

// Name implements Checker.
func (c CheckerFunc) Name() string { return c.CheckerName }

// Check implements Checker.
func (c CheckerFunc) Check(ctx context.Context) error { return c.Fn(ctx) }

// Health tracks readiness of a service. Liveness only reflects the process
// itself, so an unhealthy dependency never causes a restart loop.
type Health struct {
	mu       sync.RWMutex
	checkers []Checker
	draining bool
	version  string
}

// NewHealth builds the health registry for a service version.
func NewHealth(version string) *Health {
	return &Health{version: version}
}

// Register adds a dependency check. Calling it after the server starts is safe
// but unusual — register during wiring.
func (h *Health) Register(checker Checker) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.checkers = append(h.checkers, checker)
}

// Drain marks the service as shutting down so load balancers stop routing to
// it before the listener closes.
func (h *Health) Drain() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.draining = true
}

// Version returns the build version reported by health endpoints.
func (h *Health) Version() string { return h.version }

// LivenessHandler always answers 200 unless the process is draining.
func (h *Health) LivenessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.mu.RLock()
		draining := h.draining
		h.mu.RUnlock()
		if draining {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}
}

type readinessResponse struct {
	Status   string            `json:"status"`
	Version  string            `json:"version"`
	Checks   map[string]string `json:"checks,omitempty"`
	Failures []string          `json:"failures,omitempty"`
}

// ReadinessHandler runs every registered check with a short deadline.
func (h *Health) ReadinessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.mu.RLock()
		checkers := append([]Checker(nil), h.checkers...)
		draining := h.draining
		h.mu.RUnlock()

		response := readinessResponse{Status: "ready", Version: h.version}
		if len(checkers) > 0 {
			response.Checks = make(map[string]string, len(checkers))
		}

		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		ready := !draining
		for _, checker := range checkers {
			if err := checker.Check(ctx); err != nil {
				response.Checks[checker.Name()] = "unavailable"
				response.Failures = append(response.Failures, checker.Name())
				ready = false
				continue
			}
			response.Checks[checker.Name()] = "ok"
		}

		if !ready {
			response.Status = "not_ready"
			WriteJSON(w, r, http.StatusServiceUnavailable, response)
			return
		}
		WriteJSON(w, r, http.StatusOK, response)
	}
}

// RegisterHealthRoutes mounts the standard probe endpoints on a mux. They are
// intentionally on the root path so orchestrators do not need to know the API
// version.
func (h *Health) RegisterHealthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", h.LivenessHandler())
	mux.HandleFunc("GET /readyz", h.ReadinessHandler())
}
