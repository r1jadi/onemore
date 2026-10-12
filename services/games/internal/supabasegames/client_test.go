package supabasegames

import (
	"context"
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
	testGameID         = "11111111-1111-4111-8111-111111111111"
)

// recorded is one request the client made.
type recorded struct {
	method string
	path   string
	query  url.Values
	header http.Header
}

// stubServer serves the Data API and records what the client sent.
func stubServer(t *testing.T, handler http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()

	requests := &[]recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requests = append(*requests, recorded{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.Query(),
			header: r.Header.Clone(),
		})
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

func writeJSON(w http.ResponseWriter, status int, payload string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

const gameRowJSON = `[{"id":"11111111-1111-4111-8111-111111111111",` +
	`"slug":"stack-10","title":"Stack 10","tagline":"Make every column add up to ten.",` +
	`"description":"Drop numbered tiles into columns.","instructions":"Tap a column to drop a tile.",` +
	`"cover_path":null,"runtime":null,"playable":false,"is_official":true,` +
	`"published_at":"2026-09-01T12:00:00+00:00","updated_at":"2026-09-01T12:00:00+00:00",` +
	`"categories":{"slug":"puzzle","name":"Puzzle"}}]`

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

func TestProjectionNeverAsksForEveryColumn(t *testing.T) {
	// `select=*` would make a column added to `games` later appear in a public
	// response by accident, which is the failure this constant exists to prevent.
	if strings.Contains(gameColumns, "*") {
		t.Fatalf("the projection must name columns, got %q", gameColumns)
	}
	for _, column := range []string{"slug", "title", "tagline", "description", "instructions", "runtime", "playable", "is_official", "categories(slug,name)"} {
		if !strings.Contains(gameColumns, column) {
			t.Errorf("expected %q in the projection, got %q", column, gameColumns)
		}
	}
}

func TestListGamesQueriesOnlyPublishedGames(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	if _, err := client.ListGames(context.Background(), ListQuery{Limit: 20}); err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(*requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(*requests))
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/games" {
		t.Fatalf("path = %q", sent.path)
	}
	if sent.method != http.MethodGet {
		t.Fatalf("method = %q; this client only reads", sent.method)
	}
	if got := sent.query.Get("status"); got != "eq.published" {
		t.Fatalf("status filter = %q, want eq.published", got)
	}
	if got := sent.query.Get("order"); got != gameOrder {
		t.Fatalf("order = %q, want %q", got, gameOrder)
	}
	// One row more than the page: that extra row is how the caller learns a
	// further page exists without a COUNT.
	if got := sent.query.Get("limit"); got != "21" {
		t.Fatalf("limit = %q, want 21 for a page of 20", got)
	}
	// The catalogue is public, so the request is answered as `anon`. Sending the
	// publishable key is what identifies the project; a user token would be a
	// different (and unnecessary) trust story.
	if got := sent.header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization = %q; public reads must not carry a token", got)
	}
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Fatalf("apikey = %q, want the publishable key", got)
	}
}

func TestListGamesAppliesCategoryAndSearch(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	query := ListQuery{Limit: 10, CategoryID: "aaaaaaaa-0000-4000-8000-000000000001", Search: "stack"}
	if _, err := client.ListGames(context.Background(), query); err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	sent := (*requests)[0]
	if got := sent.query.Get("category_id"); got != "eq."+query.CategoryID {
		t.Fatalf("category_id = %q", got)
	}
	or := sent.query.Get("or")
	for _, column := range []string{"title.ilike.*stack*", "tagline.ilike.*stack*", "description.ilike.*stack*"} {
		if !strings.Contains(or, column) {
			t.Errorf("the search must cover %s, got %q", column, or)
		}
	}
}

func TestListGamesCombinesCursorAndSearchInOneLogicTree(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	stamp := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	query := ListQuery{
		Limit:            5,
		Search:           "merge",
		AfterID:          testGameID,
		AfterPublishedAt: stamp,
		HasAfter:         true,
	}
	if _, err := client.ListGames(context.Background(), query); err != nil {
		t.Fatalf("ListGames: %v", err)
	}

	sent := (*requests)[0]
	// PostgREST accepts one top-level logic tree per request. Sending `or` twice
	// would silently drop one of the two conditions, which is why both live in a
	// single `and(...)`.
	if sent.query.Get("or") != "" {
		t.Fatalf("or = %q; the keyset and the search must share one tree", sent.query.Get("or"))
	}
	tree := sent.query.Get("and")
	if tree == "" {
		t.Fatal("no logic tree was sent")
	}
	if !strings.Contains(tree, "published_at.lt.2026-09-16T12:00:00Z") {
		t.Errorf("the keyset cursor is missing from %q", tree)
	}
	if !strings.Contains(tree, "and(published_at.eq.2026-09-16T12:00:00Z,id.lt."+testGameID+")") {
		t.Errorf("the tie-break on id is missing from %q", tree)
	}
	if !strings.Contains(tree, "title.ilike.*merge*") {
		t.Errorf("the search is missing from %q", tree)
	}
}

func TestListGamesRequiresAPositiveLimit(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	if _, err := client.ListGames(context.Background(), ListQuery{}); err == nil {
		t.Fatal("expected an error for a zero limit")
	}
	if len(*requests) != 0 {
		t.Fatal("no request should have been made")
	}
}

func TestGetGameFiltersBySlugAndPublication(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, gameRowJSON)
	})

	game, found, err := client.GetGame(context.Background(), "stack-10")
	if err != nil {
		t.Fatalf("GetGame: %v", err)
	}
	if !found {
		t.Fatal("found = false for a served row")
	}
	if game.Slug != "stack-10" || game.Title != "Stack 10" {
		t.Fatalf("game = %#v", game)
	}
	if game.IsOfficial != true || game.Playable != false {
		t.Fatalf("flags = official:%v playable:%v", game.IsOfficial, game.Playable)
	}
	if game.Category == nil || game.Category.Slug != "puzzle" {
		t.Fatalf("category = %#v", game.Category)
	}
	if game.PublishedAt == nil {
		t.Fatal("published_at did not decode")
	}

	sent := (*requests)[0]
	if got := sent.query.Get("slug"); got != "eq.stack-10" {
		t.Fatalf("slug filter = %q", got)
	}
	// The status filter is what keeps an unpublished game indistinguishable from
	// a missing one, so a draft can never be discovered by guessing its slug.
	if got := sent.query.Get("status"); got != "eq.published" {
		t.Fatalf("status filter = %q, want eq.published", got)
	}
}

func TestGetGameNotFound(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	_, found, err := client.GetGame(context.Background(), "never-made")
	if err != nil {
		t.Fatalf("GetGame: %v", err)
	}
	if found {
		t.Fatal("found = true for an empty result")
	}
}

func TestGetGameRequiresASlug(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	if _, _, err := client.GetGame(context.Background(), ""); err == nil {
		t.Fatal("expected an error")
	}
	if len(*requests) != 0 {
		t.Fatal("no request should have been made")
	}
}

func TestCategoryIDResolution(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"id":"aaaaaaaa-0000-4000-8000-000000000001"}]`)
	})

	id, found, err := client.CategoryID(context.Background(), "puzzle")
	if err != nil {
		t.Fatalf("CategoryID: %v", err)
	}
	if !found || id != "aaaaaaaa-0000-4000-8000-000000000001" {
		t.Fatalf("CategoryID = %q, %v", id, found)
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/categories" {
		t.Fatalf("path = %q", sent.path)
	}
	if got := sent.query.Get("slug"); got != "eq.puzzle" {
		t.Fatalf("slug filter = %q", got)
	}
}

func TestCategoryIDUnknownSlug(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	id, found, err := client.CategoryID(context.Background(), "strategy")
	if err != nil {
		t.Fatalf("CategoryID: %v", err)
	}
	if found || id != "" {
		t.Fatalf("found = %v, id = %q", found, id)
	}
}

func TestCategoryCountsReadTheView(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"slug":"puzzle","name":"Puzzle","description":"Fit and clear.",`+
			`"sort_order":10,"game_count":2},{"slug":"word","name":"Word","description":null,`+
			`"sort_order":70,"game_count":0}]`)
	})

	counts, err := client.CategoryCounts(context.Background())
	if err != nil {
		t.Fatalf("CategoryCounts: %v", err)
	}
	if len(counts) != 2 {
		t.Fatalf("counts = %d, want 2", len(counts))
	}
	if counts[0].Slug != "puzzle" || counts[0].GameCount != 2 {
		t.Fatalf("first = %#v", counts[0])
	}
	if counts[1].GameCount != 0 {
		t.Fatalf("an empty category must report 0, got %d", counts[1].GameCount)
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/category_game_counts" {
		t.Fatalf("path = %q, want the counted view", sent.path)
	}
}

func TestSearchTermStripsFilterGrammar(t *testing.T) {
	tests := map[string]string{
		"plain":                  "merge",
		"comma":                  "stack,10",
		"parentheses":            "stack(10)",
		"wildcard":               "st*ack",
		"quotes and backslashes": `st"ack\`,
		"whitespace":             "  merged  ",
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			term, ok := SearchTerm(raw)
			if !ok {
				t.Fatalf("SearchTerm(%q) reported no searchable content", raw)
			}
			for _, forbidden := range []string{",", "(", ")", "*", `"`, `\`} {
				if strings.Contains(term, forbidden) {
					t.Fatalf("term %q still contains %q, which changes the query rather than searching for it", term, forbidden)
				}
			}
		})
	}
}

func TestSearchTermRejectsWhitespaceOnly(t *testing.T) {
	for _, raw := range []string{"", "   ", "\t\n", ",,,"} {
		if _, ok := SearchTerm(raw); ok {
			t.Fatalf("SearchTerm(%q) must report no searchable content", raw)
		}
	}
}

func TestErrorClassification(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		// PostgREST's body can echo the caller's input, so only the code may be
		// carried forward.
		writeJSON(w, http.StatusForbidden, `{"code":"42501","message":"permission denied for table games","details":"stack-10"}`)
	})

	_, err := client.ListGames(context.Background(), ListQuery{Limit: 5})
	if err == nil {
		t.Fatal("expected an error")
	}
	var dataErr *Error
	if !errors.As(err, &dataErr) {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if !dataErr.IsForbidden() {
		t.Fatal("a 42501 must be classified as forbidden")
	}
	if dataErr.Op != "list-games" {
		t.Fatalf("Op = %q", dataErr.Op)
	}
	for _, leaked := range []string{"permission denied", "stack-10"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("error %q leaked the response body", err)
		}
	}
}

func TestTransportFailureIsReportedWithoutTheURL(t *testing.T) {
	client, err := New(&config.Config{Supabase: config.Supabase{
		ProjectURL:     "http://127.0.0.1:1", // nothing listens here
		PublishableKey: testPublishableKey,
	}})
	if err != nil {
		t.Fatalf("building client: %v", err)
	}

	_, listErr := client.ListGames(context.Background(), ListQuery{Limit: 5})
	if listErr == nil {
		t.Fatal("expected a transport error")
	}
	var dataErr *Error
	if !errors.As(listErr, &dataErr) {
		t.Fatalf("error type = %T, want *Error", listErr)
	}
	if dataErr.Status != 0 {
		t.Fatalf("Status = %d, want 0 for a call that never completed", dataErr.Status)
	}
}

func TestUndecodableBodyIsAReportedFailure(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "not json at all")
	})
	if _, err := client.CategoryCounts(context.Background()); err == nil {
		t.Fatal("expected an error for an undecodable body")
	}
}

func TestBodyIsBounded(t *testing.T) {
	// A body that never ends must not be read forever; the client stops at
	// maxBodyBytes and reports a decode failure instead of hanging.
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "[")
		_, _ = io.WriteString(w, strings.Repeat(" ", maxBodyBytes+16))
	})
	if _, err := client.CategoryCounts(context.Background()); err == nil {
		t.Fatal("expected a bounded read to fail rather than succeed")
	}
}
