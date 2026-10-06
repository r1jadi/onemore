package proxy

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
)

// recorder is a stand-in upstream service.
type recorder struct {
	server     *httptest.Server
	requests   int
	lastPath   string
	lastQuery  string
	lastHeader http.Header
}

func newRecorder(t *testing.T) *recorder {
	t.Helper()
	rec := &recorder{}
	rec.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.requests++
		rec.lastPath = r.URL.Path
		rec.lastQuery = r.URL.RawQuery
		rec.lastHeader = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"upstream":true}`))
	}))
	t.Cleanup(rec.server.Close)
	return rec
}

func testConfig(upstreams map[string]string) *config.Config {
	return &config.Config{
		Service:     "gateway",
		Environment: config.EnvDevelopment,
		Upstreams:   upstreams,
	}
}

func proxyHandler(t *testing.T, upstreams map[string]string) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(upstreams), logger)
	return p.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
}

func do(t *testing.T, handler http.Handler, method, target string, headers map[string]string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Result()
}

func TestForwardsToConfiguredUpstream(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	response := do(t, handler, http.MethodGet, "/api/v1/games?limit=10", map[string]string{
		"Authorization": "Bearer abc.def.ghi",
	})

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if upstream.requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", upstream.requests)
	}
	if upstream.lastPath != "/api/v1/games" || upstream.lastQuery != "limit=10" {
		t.Fatalf("upstream saw %s?%s", upstream.lastPath, upstream.lastQuery)
	}
	if got := upstream.lastHeader.Get("Authorization"); got != "Bearer abc.def.ghi" {
		t.Fatalf("Authorization = %q; the upstream must verify the token itself", got)
	}
	if got := upstream.lastHeader.Get("X-Forwarded-For"); got == "" {
		t.Error("X-Forwarded-For missing on the upstream request")
	}
}

func TestClientSuppliedIdentityHeadersAreRemoved(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	do(t, handler, http.MethodGet, "/api/v1/games", map[string]string{
		"X-User-ID":       "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",
		"X-User-Role":     "admin",
		"X-Is-Admin":      "true",
		"X-Admin":         "1",
		"X-Supabase-Auth": "trusted",
	})

	for _, header := range identityHeaders {
		if got := upstream.lastHeader.Get(header); got != "" {
			t.Errorf("identity header %s reached the upstream with %q", header, got)
		}
	}
}

func TestUnconfiguredGroupIsNotProxied(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	response := do(t, handler, http.MethodGet, "/api/v1/admin/users", nil)

	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if upstream.requests != 0 {
		t.Fatalf("upstream was called %d times for a different group", upstream.requests)
	}

	body, _ := io.ReadAll(response.Body)
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if payload["error"] == nil {
		t.Fatal("503 did not use the error envelope")
	}
}

func TestMalformedUpstreamIsDroppedInsteadOfTrusted(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(map[string]string{
		"games":    "file:///etc/passwd",
		"users":    "https://users.internal.example",
		"comments": "https://social.internal.example/?q=1",
	}), logger)

	routes := p.Routes()
	if _, ok := routes["/api/v1/games"]; ok {
		t.Error("a non-http upstream URL must not be routable")
	}
	if routes["/api/v1/games"] != "" {
		t.Error("a non-http upstream URL must not be routable")
	}
	if routes["/api/v1/users"] != "https://users.internal.example" {
		t.Errorf("valid upstream was dropped: %v", routes)
	}
	if _, ok := routes["/api/v1/comments"]; ok {
		t.Error("an upstream with a query string must be rejected")
	}
}

func TestNonAPIPathFallsThroughToTheNextHandler(t *testing.T) {
	handler := proxyHandler(t, nil)

	response := do(t, handler, http.MethodGet, "/healthz", nil)

	if response.StatusCode != http.StatusTeapot {
		t.Fatalf("status = %d, want the fallback handler's 418", response.StatusCode)
	}
}

func TestGatewayOwnedPathsAreNotTreatedAsUnconfiguredGroups(t *testing.T) {
	handler := proxyHandler(t, nil)

	// `/api/v1` (version discovery) and `/api/v1/health` (liveness) belong to the
	// gateway's own router. Answering them with the unconfigured-upstream 503
	// would make a healthy deployment look down to every probe that reports it.
	for _, path := range []string{"/api/v1", "/api/v1/", httpx.HealthPath} {
		response := do(t, handler, http.MethodGet, path, nil)
		response.Body.Close()
		if response.StatusCode != http.StatusTeapot {
			t.Errorf("%s = %d, want the fallback handler's 418 (never proxied, never 503)", path, response.StatusCode)
		}
	}
}

func TestLongestPrefixWins(t *testing.T) {
	admin := newRecorder(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(map[string]string{"admin": admin.server.URL}), logger)

	found := false
	for _, rt := range p.routes {
		if rt.prefix == "/api/v1/admin" && rt.service == "admin" {
			found = true
		}
	}
	if !found {
		t.Fatal("/api/v1/admin is not mapped to the admin service")
	}
}
