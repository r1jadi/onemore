package supabaseprofile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/r1jadi/onemore/packages/go/platform/config"
)

const (
	testPublishableKey = "sb_publishable_test_value"
	testUserID         = "9a1b6f62-0a4e-4d6e-9d5f-6c1f5a2b3c4d"
	testAccessToken    = "callers-access-token"
)

// recorded is one request the client made.
type recorded struct {
	method string
	path   string
	query  url.Values
	header http.Header
	body   map[string]any
}

// stubServer serves the Data API endpoints and records what the client sent.
func stubServer(t *testing.T, handler http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()

	requests := &[]recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := recorded{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.Query(),
			header: r.Header.Clone(),
		}
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

const profileRow = `[{"id":"9a1b6f62-0a4e-4d6e-9d5f-6c1f5a2b3c4d",` +
	`"username":"player_one","display_name":"Player One",` +
	`"bio":"Puzzles in the morning.","avatar_path":null,"onboarded_at":null,` +
	`"created_at":"2026-10-01T10:00:00.000Z","updated_at":"2026-10-08T09:30:00.123456Z"}]`

func TestNewRequiresConfiguration(t *testing.T) {
	tests := map[string]config.Supabase{
		"no url":             {PublishableKey: testPublishableKey},
		"no publishable key": {ProjectURL: "https://example.supabase.co"},
		"neither":            {},
	}
	for name, supabase := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := New(&config.Config{Supabase: supabase}); err == nil {
				t.Fatal("expected an error, got none")
			}
		})
	}
}

func TestColumnsNeverProjectsEveryColumn(t *testing.T) {
	// `select=*` and a bare `Prefer: return=representation` both ask for
	// `is_suspended`, which the SELECT grant deliberately withholds, so either
	// one turns every read and write into a 403.
	if strings.Contains(Columns, "*") {
		t.Fatalf("the projection must name columns, got %q", Columns)
	}
	if strings.Contains(Columns, "is_suspended") {
		t.Fatalf("the projection must not ask for is_suspended, got %q", Columns)
	}
	for _, column := range []string{"id", "username", "display_name", "bio", "avatar_path", "onboarded_at", "created_at", "updated_at"} {
		if !strings.Contains(Columns, column) {
			t.Fatalf("expected %q in the projection, got %q", column, Columns)
		}
	}
}

func TestGetProfileReadsOneRow(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	profile, found, err := client.GetProfile(context.Background(), testAccessToken, testUserID)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if !found {
		t.Fatal("expected the row to be reported as found")
	}
	if profile.Username != "player_one" || profile.DisplayName != "Player One" {
		t.Fatalf("unexpected profile: %+v", profile)
	}
	if profile.Bio == nil || *profile.Bio != "Puzzles in the morning." {
		t.Fatalf("expected the bio to be read, got %+v", profile.Bio)
	}
	if profile.UpdatedAt.IsZero() || profile.CreatedAt.IsZero() {
		t.Fatalf("expected both timestamps, got %+v", profile)
	}

	request := (*requests)[0]
	if request.method != http.MethodGet {
		t.Fatalf("expected GET, got %s", request.method)
	}
	if request.path != "/rest/v1/profiles" {
		t.Fatalf("unexpected path: %s", request.path)
	}
	if got := request.query.Get("select"); got != Columns {
		t.Fatalf("expected the named projection %q, got %q", Columns, got)
	}
	if got := request.query.Get("id"); got != "eq."+testUserID {
		t.Fatalf("expected the caller's own id, got %q", got)
	}
	if got := request.query.Get("limit"); got != "1" {
		t.Fatalf("expected a single row, got limit=%q", got)
	}
	if got := request.header.Get("apikey"); got != testPublishableKey {
		t.Fatalf("expected the publishable key, got %q", got)
	}
	// The caller's own token is what RLS evaluates; the secret key is never used.
	if got := request.header.Get("Authorization"); got != "Bearer "+testAccessToken {
		t.Fatalf("expected the caller's token, got %q", got)
	}
	if request.body != nil {
		t.Fatalf("a read must not send a body, got %v", request.body)
	}
}

func TestGetProfileMissingRowIsNotAnError(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, `[]`)
	})

	profile, found, err := client.GetProfile(context.Background(), testAccessToken, testUserID)
	if err != nil {
		t.Fatalf("a missing row must not be an error: %v", err)
	}
	if found {
		t.Fatal("expected found to be false")
	}
	if profile.ID != "" {
		t.Fatalf("expected an empty profile, got %+v", profile)
	}
}

func TestGetProfileRefusesAnEmptyUserID(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the client must not call the Data API without a subject")
	})

	if _, _, err := client.GetProfile(context.Background(), testAccessToken, ""); err == nil {
		t.Fatal("expected an error, got none")
	}
	if len(*requests) != 0 {
		t.Fatalf("expected no request, got %d", len(*requests))
	}
}

func TestGetProfileSurfacesAPrivilegeFailure(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusForbidden, `{"code":"42501","message":"permission denied for table profiles"}`)
	})

	_, _, err := client.GetProfile(context.Background(), testAccessToken, testUserID)
	if err == nil {
		t.Fatal("expected an error, got none")
	}
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected a *Error, got %T", err)
	}
	if !apiErr.IsForbidden() {
		t.Fatalf("expected a forbidden error, got %+v", apiErr)
	}
	if apiErr.Status != http.StatusForbidden || apiErr.Code != codeInsufficientPrivilege {
		t.Fatalf("expected status 403 and the SQLSTATE, got %+v", apiErr)
	}
	// PostgREST's message can describe the schema or echo caller input, so it is
	// never carried into an error a service might log.
	if strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("the upstream message must not be carried: %v", err)
	}
}

func TestGetProfileRejectsAnUndecodableBody(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, `<html>not json</html>`)
	})

	_, _, err := client.GetProfile(context.Background(), testAccessToken, testUserID)
	if err == nil {
		t.Fatal("expected an error, got none")
	}
	if strings.Contains(err.Error(), "not json") {
		t.Fatalf("the upstream body must not be echoed: %v", err)
	}
}

func TestGetProfileSurfacesATransportFailure(t *testing.T) {
	client, _ := stubServer(t, func(http.ResponseWriter, *http.Request) {})

	// Point the built client at a server that is already gone, which is how a
	// Data API outage reaches the client.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	client.baseURL = server.URL
	server.Close()

	_, _, err := client.GetProfile(context.Background(), testAccessToken, testUserID)
	if err == nil {
		t.Fatal("expected an error, got none")
	}
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected a *Error, got %T", err)
	}
	if apiErr.Status != 0 {
		t.Fatalf("expected status 0 for a transport failure, got %d", apiErr.Status)
	}
}

func TestUpdateWritesOnlyTheNamedColumns(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	bio := "arcade at night."
	_, found, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{
		DisplayName: "Player One",
		Bio:         &bio,
		SetBio:      true,
	}, time.Time{})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if !found {
		t.Fatal("expected the updated row to be reported as found")
	}

	request := (*requests)[0]
	if request.method != http.MethodPatch {
		t.Fatalf("expected PATCH, got %s", request.method)
	}
	if request.path != "/rest/v1/profiles" {
		t.Fatalf("unexpected path: %s", request.path)
	}
	if got := request.query.Get("select"); got != Columns {
		t.Fatalf("a write must name its projection, got %q", got)
	}
	if got := request.query.Get("id"); got != "eq."+testUserID {
		t.Fatalf("expected the caller's own id, got %q", got)
	}
	if got := request.header.Get("Prefer"); got != "return=representation" {
		t.Fatalf("expected the representation preference, got %q", got)
	}
	if len(request.body) != 2 {
		t.Fatalf("expected exactly the two named columns, got %v", request.body)
	}
	if request.body["display_name"] != "Player One" || request.body["bio"] != bio {
		t.Fatalf("unexpected payload: %v", request.body)
	}
	// A column the caller did not mention must not appear at all: an explicit null
	// would clear it.
	if _, present := request.body["avatar_path"]; present {
		t.Fatalf("an unmentioned column must be absent, got %v", request.body)
	}
	if _, present := request.body["onboarded_at"]; present {
		t.Fatalf("an unmentioned column must be absent, got %v", request.body)
	}
	if _, present := request.body["username"]; present {
		t.Fatalf("an unmentioned column must be absent, got %v", request.body)
	}
}

func TestUpdateWritesTheUsernameWhenNamed(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	_, _, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{
		Username: "rijad_2",
	}, time.Time{})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	body := (*requests)[0].body
	if body["username"] != "rijad_2" {
		t.Fatalf("expected username to be written, got %v", body)
	}
}

func TestUpdateClearsANullableColumn(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	_, _, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{SetBio: true}, time.Time{})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	// A nil bio with SetBio set is an explicit null, not "leave it alone".
	body := (*requests)[0].body
	value, present := body["bio"]
	if !present {
		t.Fatalf("expected bio to be written, got %v", body)
	}
	if value != nil {
		t.Fatalf("expected bio to be cleared, got %v", value)
	}
}

func TestUpdateRefusesAnEmptyPatch(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the client must not send an empty patch")
	})

	if _, _, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{}, time.Time{}); err == nil {
		t.Fatal("expected an error, got none")
	}
	if len(*requests) != 0 {
		t.Fatalf("expected no request, got %d", len(*requests))
	}
}

func TestUpdateFiltersOnTheExpectedTimestamp(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	expected, err := time.Parse(time.RFC3339Nano, "2026-10-08T09:30:00.123456Z")
	if err != nil {
		t.Fatalf("parsing the expectation: %v", err)
	}
	_, _, err = client.Update(context.Background(), testAccessToken, testUserID, Patch{DisplayName: "Player One"}, expected)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got := (*requests)[0].query.Get("updated_at"); got != "eq.2026-10-08T09:30:00.123456Z" {
		t.Fatalf("expected the concurrency filter, got %q", got)
	}
}

func TestUpdateWithoutAnExpectationIsLastWriteWins(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, http.StatusOK, profileRow)
	})

	_, _, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{DisplayName: "Player One"}, time.Time{})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if _, present := (*requests)[0].query["updated_at"]; present {
		t.Fatalf("expected no concurrency filter, got %v", (*requests)[0].query)
	}
}

func TestUpdateReportsAStaleRowAsNotFound(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		// The filter matched nothing, so PostgREST answers with an empty array.
		writeJSON(t, w, http.StatusOK, `[]`)
	})

	_, found, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{DisplayName: "Player One"}, time.Time{})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if found {
		t.Fatal("expected found to be false when the filter matched no row")
	}
}

func TestUpdateRefusesAnEmptyUserID(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the client must not call the Data API without a subject")
	})

	if _, _, err := client.Update(context.Background(), testAccessToken, "", Patch{DisplayName: "Player One"}, time.Time{}); err == nil {
		t.Fatal("expected an error, got none")
	}
	if len(*requests) != 0 {
		t.Fatalf("expected no request, got %d", len(*requests))
	}
}

func TestUpdateMapsDatabaseFailures(t *testing.T) {
	tests := map[string]struct {
		status  int
		body    string
		matches func(*Error) bool
	}{
		"unique violation": {
			status:  http.StatusConflict,
			body:    `{"code":"23505","message":"duplicate key value violates unique constraint"}`,
			matches: (*Error).IsUniqueViolation,
		},
		"check violation": {
			status:  http.StatusBadRequest,
			body:    `{"code":"23514","message":"new row violates check constraint"}`,
			matches: (*Error).IsConstraintViolation,
		},
		"not null violation": {
			status:  http.StatusBadRequest,
			body:    `{"code":"23502","message":"null value in column violates not-null constraint"}`,
			matches: (*Error).IsConstraintViolation,
		},
		"foreign key violation": {
			status:  http.StatusConflict,
			body:    `{"code":"23503","message":"insert or update violates foreign key constraint"}`,
			matches: (*Error).IsConstraintViolation,
		},
		"insufficient privilege": {
			status:  http.StatusForbidden,
			body:    `{"code":"42501","message":"permission denied for table profiles"}`,
			matches: (*Error).IsForbidden,
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
				writeJSON(t, w, test.status, test.body)
			})

			_, _, err := client.Update(context.Background(), testAccessToken, testUserID, Patch{DisplayName: "Player One"}, time.Time{})
			var apiErr *Error
			if !errors.As(err, &apiErr) {
				t.Fatalf("expected a *Error, got %T", err)
			}
			if !test.matches(apiErr) {
				t.Fatalf("expected the failure to be recognised, got %+v", apiErr)
			}
			if strings.Contains(err.Error(), "constraint") || strings.Contains(err.Error(), "permission denied") {
				t.Fatalf("the upstream message must not be carried: %v", err)
			}
		})
	}
}

func TestErrorCodeKeepsOnlyMachineReadableCodes(t *testing.T) {
	// A code with spaces or capital letters is a human message PostgREST put in
	// the field, and it is dropped rather than logged.
	code, err := errorCode(strings.NewReader(`{"code":"Pending server restart","message":"x"}`))
	if err != nil {
		t.Fatalf("errorCode: %v", err)
	}
	if code != "" {
		t.Fatalf("expected the message to be dropped, got %q", code)
	}

	code, err = errorCode(strings.NewReader(`{"code":"42501","message":"x"}`))
	if err != nil {
		t.Fatalf("errorCode: %v", err)
	}
	if code != "42501" {
		t.Fatalf("expected the SQLSTATE, got %q", code)
	}
}
