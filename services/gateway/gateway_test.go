package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

// newGateway serves the wired gateway over httptest. It builds the same
// middleware chain httpx.Run builds for the two entrypoints, but without
// binding a port, so the test exercises the real routing rather than a
// hand-written handler.
func newGateway(t *testing.T) *httptest.Server {
	t.Helper()

	// No Supabase auth material and no UPSTREAM_*_URL: the state a fresh
	// deployment is in before any backend service exists.
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("LOG_LEVEL", "error")
	t.Setenv("HTTP_ADDR", ":0")

	options := Options()
	service := servicekit.New(options)

	var extra []httpx.Middleware
	if options.ExtraHandlers != nil {
		extra = options.ExtraHandlers(service.Config(), service.Logger())
	}

	server := httpx.NewServer(httpx.ServerOptions{
		Config:        service.Config(),
		Router:        service.Router(),
		Health:        service.Health(),
		Logger:        service.Logger(),
		ExtraHandlers: extra,
	})
	test := httptest.NewServer(server.Handler)
	t.Cleanup(test.Close)
	return test
}

func get(t *testing.T, server *httptest.Server, path string, headers map[string]string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, server.URL+path, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	return response
}

func decode(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, body)
	}
	return payload
}

// TestHealthPathIsThePublishedPath pins the one path the deployment, the OpenAPI
// contract and the documentation all name. A rename here has to be a decision,
// not an accident.
func TestHealthPathIsThePublishedPath(t *testing.T) {
	if httpx.HealthPath != "/api/v1/health" {
		t.Fatalf("httpx.HealthPath = %q, want /api/v1/health", httpx.HealthPath)
	}
}

// TestHealthEndpointIsDeterministic is the smoke test behind
// `GET /api/v1/health`: the deployment is healthy when this route answers 200,
// with no Supabase project, no upstream and no token involved.
func TestHealthEndpointIsDeterministic(t *testing.T) {
	server := newGateway(t)

	response := get(t, server, httpx.HealthPath, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%s = %d, want 200", httpx.HealthPath, response.StatusCode)
	}
	payload := decode(t, response)
	if payload["status"] != "ok" {
		t.Fatalf("status = %v, want ok", payload["status"])
	}
	if payload["version"] == nil {
		t.Error("the health response should report the build version")
	}

	// A client that sends a junk token must not turn health red: this route is
	// public, so it never reaches the code path that needs a verifier.
	authorized := get(t, server, httpx.HealthPath, map[string]string{
		"Authorization": "Bearer " + strings.Repeat("x", 64),
	})
	authorized.Body.Close()
	if authorized.StatusCode != http.StatusOK {
		t.Fatalf("health with a token = %d, want 200 (the route must not require authentication)", authorized.StatusCode)
	}
}

// TestLivenessReadinessAndVersionDiscoveryCoexist pins every answer a probe or a
// client can get, and keeps liveness (`/healthz`, `HealthPath`) separate from
// readiness (`/readyz`).
func TestLivenessReadinessAndVersionDiscoveryCoexist(t *testing.T) {
	server := newGateway(t)

	liveness := get(t, server, "/healthz", nil)
	liveness.Body.Close()
	if liveness.StatusCode != http.StatusOK {
		t.Errorf("/healthz = %d, want 200", liveness.StatusCode)
	}

	readiness := get(t, server, "/readyz", nil)
	if readiness.StatusCode != http.StatusOK {
		t.Errorf("/readyz = %d, want 200", readiness.StatusCode)
	}
	if payload := decode(t, readiness); payload["status"] != "ready" {
		t.Errorf("readiness status = %v, want ready", payload["status"])
	}

	version := get(t, server, "/api/v1", nil)
	if version.StatusCode != http.StatusOK {
		t.Errorf("/api/v1 = %d, want 200", version.StatusCode)
	}
	if payload := decode(t, version); payload["apiVersion"] != "v1" {
		t.Errorf("apiVersion = %v, want v1", payload["apiVersion"])
	}
}

// TestGatewayOwnedRoutesDoNotNeedAnUpstream guards the difference between the
// gateway's own routes and a service group: only a group without a configured
// upstream answers 503, so health and version discovery keep working in the
// environment every deployment starts in — the one where nothing is behind the
// gateway yet.
func TestGatewayOwnedRoutesDoNotNeedAnUpstream(t *testing.T) {
	server := newGateway(t)

	unconfigured := get(t, server, "/api/v1/games", nil)
	if unconfigured.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("/api/v1/games = %d, want 503 while UPSTREAM_GAMES_URL is unset", unconfigured.StatusCode)
	}
	if payload := decode(t, unconfigured); payload["error"] == nil {
		t.Error("the 503 must use the standard error envelope")
	}

	health := get(t, server, httpx.HealthPath, nil)
	health.Body.Close()
	if health.StatusCode != http.StatusOK {
		t.Errorf("%s = %d, want 200", httpx.HealthPath, health.StatusCode)
	}
}
