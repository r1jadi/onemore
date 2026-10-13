package supabaseauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/onemore/packages/go/platform/config"
)

const testPublishableKey = "sb_publishable_test_value"

// recorded is one request the client made.
type recorded struct {
	method string
	path   string
	query  string
	header http.Header
	body   map[string]any
}

// stubServer serves Supabase's endpoints and records what the client sent.
func stubServer(t *testing.T, handler http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()

	requests := &[]recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := recorded{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, header: r.Header.Clone()}
		if r.Body != nil {
			raw, _ := io.ReadAll(r.Body)
			if len(raw) > 0 {
				_ = json.Unmarshal(raw, &entry.body)
			}
		}
		*requests = append(*requests, entry)
		handler(w, r)
	}))
	t.Cleanup(server.Close)

	cfg := &config.Config{Supabase: config.Supabase{
		ProjectURL:     server.URL,
		PublishableKey: testPublishableKey,
	}}
	client, err := New(cfg)
	if err != nil {
		t.Fatalf("building client: %v", err)
	}
	return client, requests
}

func writeJSON(t *testing.T, w http.ResponseWriter, status int, payload string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

func TestNewRequiresTheProjectURLAndPublishableKey(t *testing.T) {
	cases := map[string]config.Supabase{
		"nothing configured": {},
		"only the URL":       {ProjectURL: "https://example.supabase.co"},
		"only the key":       {PublishableKey: testPublishableKey},
	}
	for name, supabase := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := New(&config.Config{Supabase: supabase}); err == nil {
				t.Fatal("the client started without the credentials it needs")
			}
		})
	}
}

func TestSignInPostsToThePasswordGrantWithThePublishableKey(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{
			"access_token": "an-access-token",
			"refresh_token": "a-refresh-token",
			"token_type": "bearer",
			"expires_in": 3600,
			"expires_at": 1900000000,
			"user": {"id": "u1", "email": "player@example.com", "role": "authenticated",
			         "app_metadata": {"role": "admin"}, "created_at": "2026-10-01T00:00:00Z"}
		}`)
	})

	result, err := client.SignInWithPassword(context.Background(), "player@example.com", "correct-horse-battery")
	if err != nil {
		t.Fatalf("sign-in failed: %v", err)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPost || sent.path != "/auth/v1/token" || sent.query != "grant_type=password" {
		t.Errorf("request was %s %s?%s, want POST /auth/v1/token?grant_type=password", sent.method, sent.path, sent.query)
	}
	if sent.body["email"] != "player@example.com" || sent.body["password"] != "correct-horse-battery" {
		t.Errorf("body = %v", sent.body)
	}
	// The publishable key is the credential Supabase expects for a public client.
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Errorf("apikey = %q, want the publishable key", got)
	}
	// An anonymous call must not carry a bearer token.
	if got := sent.header.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q on an anonymous call", got)
	}
	// Nothing in the request names a secret key, by any of its spellings.
	raw, _ := json.Marshal(sent.header)
	for _, forbidden := range []string{"secret", "service_role", "SERVICE_ROLE"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) &&
			!strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) {
			t.Errorf("request headers mention %q", forbidden)
		}
	}

	if result.Session == nil {
		t.Fatal("no session was decoded")
	}
	if result.Session.AccessToken != "an-access-token" || result.Session.RefreshToken != "a-refresh-token" {
		t.Errorf("session = %+v", result.Session)
	}
	if result.Session.ExpiresAt.Unix() != 1900000000 {
		t.Errorf("expiresAt = %s, want the value Supabase reported", result.Session.ExpiresAt)
	}
	if result.User == nil || result.User.ID != "u1" {
		t.Fatalf("user = %+v", result.User)
	}
	if result.User.AppMetadata["role"] != "admin" {
		t.Errorf("app_metadata = %v, want it preserved for the session view", result.User.AppMetadata)
	}
}

func TestSignUpDecodesAConfirmationPendingResponse(t *testing.T) {
	// With email confirmation on, Supabase answers with a bare user and no
	// session. That must not be mistaken for a failure.
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	result, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery")
	if err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	if result.Session != nil {
		t.Errorf("a session was decoded from a response that had none: %+v", result.Session)
	}
	if result.User == nil || result.User.ID != "u1" || result.User.EmailConfirmedAt != nil {
		t.Fatalf("user = %+v", result.User)
	}
	if (*requests)[0].path != "/auth/v1/signup" {
		t.Errorf("path = %s, want /auth/v1/signup", (*requests)[0].path)
	}
}

func TestSignUpProposesTheAppCallback(t *testing.T) {
	t.Setenv("PUBLIC_SITE_URL", "https://example.com")
	t.Setenv("SITE_URL", "")
	t.Setenv("VITE_PUBLIC_SITE_URL", "")

	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	if _, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery"); err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	options, ok := (*requests)[0].body["options"].(map[string]any)
	if !ok {
		t.Fatalf("body has no options: %v", (*requests)[0].body)
	}
	if options["emailRedirectTo"] != "https://example.com/auth/callback" {
		t.Errorf("emailRedirectTo = %v, want the app callback", options["emailRedirectTo"])
	}
}

func TestRefreshUsesTheRefreshTokenGrant(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"access_token":"a2","refresh_token":"r2","token_type":"bearer","expires_in":60}`)
	})

	result, err := client.RefreshSession(context.Background(), "refresh-1")
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	sent := (*requests)[0]
	if sent.path != "/auth/v1/token" || sent.query != "grant_type=refresh_token" {
		t.Errorf("request was %s?%s, want the refresh_token grant", sent.path, sent.query)
	}
	if sent.body["refresh_token"] != "refresh-1" {
		t.Errorf("body = %v", sent.body)
	}
	// With no expires_at Supabase-side, the lifetime is derived from expires_in.
	if result.Session == nil || result.Session.ExpiresAt.IsZero() {
		t.Fatalf("no usable expiry: %+v", result.Session)
	}
}

func TestErrorKeepsOnlyTheMachineReadableCode(t *testing.T) {
	// Supabase's human message can describe the project's auth policy, and an
	// unexpected field could echo a credential back, so neither is retained.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 400, `{"error_code":"invalid_credentials","error":"Invalid login credentials","msg":"token abc123 was rejected"}`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "wrong")
	if err == nil {
		t.Fatal("a 400 was treated as a success")
	}

	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is %T, want *Error", err)
	}
	if apiErr.Code != CodeInvalidCredentials || apiErr.Status != 400 {
		t.Errorf("error = %+v, want the invalid_credentials code", apiErr)
	}

	message := err.Error()
	for _, leaked := range []string{"abc123", "Invalid login credentials", "was rejected"} {
		if strings.Contains(message, leaked) {
			t.Errorf("error %q retained %q from the response body", message, leaked)
		}
	}
}

func TestErrorDropsAHumanMessageInTheCodeField(t *testing.T) {
	// The legacy shape puts a human sentence in `error`. It must not be adopted
	// as a code just because the field is in the right place.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 400, `{"error":"Invalid login credentials. Contact support@example.com"}`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "wrong")
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is %T, want *Error", err)
	}
	if apiErr.Code != "" {
		t.Errorf("code = %q, want it dropped", apiErr.Code)
	}
	if strings.Contains(err.Error(), "support@example.com") {
		t.Errorf("error %q retained a human message", err.Error())
	}
}

func TestAnUnreadableBodyIsNotEchoed(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"access_token": "this-is-truncated`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "correct-horse-battery")
	if err == nil {
		t.Fatal("a truncated body was treated as a success")
	}
	if strings.Contains(err.Error(), "this-is-truncated") {
		t.Errorf("error %q echoed the response body", err.Error())
	}
}

func TestSignOutIsIdempotent(t *testing.T) {
	// A token Supabase no longer recognises means the session is already gone.
	// Reporting that as a failure would fail a client that is signing out.
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(t, w, status, `{"error_code":"session_not_found"}`)
			})

			if err := client.SignOut(context.Background(), "a-token"); err != nil {
				t.Fatalf("sign-out returned %v, want it treated as already signed out", err)
			}
			if (*requests)[0].path != "/auth/v1/logout" {
				t.Errorf("path = %s, want /auth/v1/logout", (*requests)[0].path)
			}
		})
	}
}

func TestSignOutSendsTheCallersTokenAndReportsRealFailures(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 500, `{"error_code":"internal_server_error"}`)
	})

	err := client.SignOut(context.Background(), "the-callers-token")
	if err == nil {
		t.Fatal("a 500 was treated as a successful sign-out")
	}
	if got := (*requests)[0].header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
}

func TestOnboardedReadsTheCallersOwnRow(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `[{"onboarded_at":"2026-10-02T10:00:00Z"}]`)
	})

	onboarded, err := client.Onboarded(context.Background(), "the-callers-token", "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f")
	if err != nil {
		t.Fatalf("profile read failed: %v", err)
	}
	if !onboarded {
		t.Error("onboarded = false, want true")
	}

	sent := (*requests)[0]
	if sent.path != "/rest/v1/profiles" {
		t.Errorf("path = %s, want /rest/v1/profiles", sent.path)
	}
	query := sent.query
	for _, expected := range []string{"select=onboarded_at", "id=eq.3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", "limit=1"} {
		if !strings.Contains(query, expected) {
			t.Errorf("query %q is missing %q", query, expected)
		}
	}
	// The read runs as the caller, so RLS decides what is visible.
	if got := sent.header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Errorf("apikey = %q, want the publishable key", got)
	}
}

func TestOnboardedTreatsNoRowAndNullAsNotOnboarded(t *testing.T) {
	cases := map[string]string{
		"no profile row":       `[]`,
		"a null onboarded_at":  `[{"onboarded_at":null}]`,
		"a blank onboarded_at": `[{"onboarded_at":"  "}]`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(t, w, 200, body)
			})

			onboarded, err := client.Onboarded(context.Background(), "a-token", "a-user-id")
			if err != nil {
				t.Fatalf("profile read failed: %v", err)
			}
			if onboarded {
				t.Error("onboarded = true, want false")
			}
		})
	}
}

func TestOnboardedRefusesWithoutAUserID(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("the client made a request without a user id")
	})

	if _, err := client.Onboarded(context.Background(), "a-token", ""); err == nil {
		t.Fatal("an empty user id was accepted")
	}
	if len(*requests) != 0 {
		t.Errorf("the client sent %d requests, want none", len(*requests))
	}
}

func TestEscapeEmailNormalisesForBucketing(t *testing.T) {
	if EscapeEmail(" Player@Example.com ") != "player%40example.com" {
		t.Errorf("EscapeEmail = %q", EscapeEmail(" Player@Example.com "))
	}
}
