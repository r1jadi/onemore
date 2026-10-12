package games

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/games/internal/supabasegames"
)

const (
	publishedID = "11111111-1111-4111-8111-111111111111"
	olderID     = "22222222-2222-4222-8222-222222222222"
	oldestID    = "33333333-3333-4333-8333-333333333333"
)

// fakeBackend stands in for the Supabase client. It is deliberately dumb: it
// returns what it was given and records the last query, so a test asserts what
// the handler *asked for* as well as what it rendered.
type fakeBackend struct {
	games       []supabasegames.Game
	categoryIDs map[string]string
	counts      []supabasegames.CategoryCount
	err         error
	lastQuery   supabasegames.ListQuery
	listCalls   int
}

func (b *fakeBackend) ListGames(_ context.Context, query supabasegames.ListQuery) ([]supabasegames.Game, error) {
	b.listCalls++
	b.lastQuery = query
	if b.err != nil {
		return nil, b.err
	}
	// The real client always asks the Data API for one row more than the page,
	// so the fake returns the same shape.
	limit := query.Limit + 1
	if limit > len(b.games) {
		limit = len(b.games)
	}
	return b.games[:limit], nil
}

func (b *fakeBackend) GetGame(_ context.Context, slug string) (supabasegames.Game, bool, error) {
	if b.err != nil {
		return supabasegames.Game{}, false, b.err
	}
	for _, game := range b.games {
		if game.Slug == slug {
			return game, true, nil
		}
	}
	return supabasegames.Game{}, false, nil
}

func (b *fakeBackend) CategoryID(_ context.Context, slug string) (string, bool, error) {
	if b.err != nil {
		return "", false, b.err
	}
	id, ok := b.categoryIDs[slug]
	return id, ok, nil
}

func (b *fakeBackend) CategoryCounts(_ context.Context) ([]supabasegames.CategoryCount, error) {
	if b.err != nil {
		return nil, b.err
	}
	return b.counts, nil
}

func testGame(id, slug, title string, publishedAt time.Time) supabasegames.Game {
	stamp := publishedAt.UTC()
	tagline := "Make every column add up to ten."
	return supabasegames.Game{
		ID:          id,
		Slug:        slug,
		Title:       title,
		Tagline:     &tagline,
		IsOfficial:  true,
		PublishedAt: &stamp,
		UpdatedAt:   stamp,
		Category:    &supabasegames.Category{Slug: "puzzle", Name: "Puzzle"},
	}
}

func testBackend() *fakeBackend {
	base := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	return &fakeBackend{
		games: []supabasegames.Game{
			testGame(publishedID, "one-move", "One Move", base),
			testGame(olderID, "memory-flash", "Memory Flash", base.Add(-48*time.Hour)),
			testGame(oldestID, "stack-10", "Stack 10", base.Add(-96*time.Hour)),
		},
		categoryIDs: map[string]string{"puzzle": "aaaaaaaa-0000-4000-8000-000000000001"},
		counts: []supabasegames.CategoryCount{
			{Slug: "puzzle", Name: "Puzzle", GameCount: 2},
			{Slug: "word", Name: "Word", GameCount: 0},
		},
	}
}

// router serves the public catalogue exactly as production does, including
// Go's method+pattern routing (which is what makes `{slug}` resolvable).
func testServer(t *testing.T, backend Backend) *httptest.Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := httpx.NewRouter(httpx.RouterOptions{Config: &config.Config{}, Logger: logger})
	newService(backend, logger).register(router)

	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)
	return server
}

// get performs a request and returns the status plus the decoded body.
func get(t *testing.T, server *httptest.Server, path string) (int, map[string]any) {
	t.Helper()
	response, err := http.Get(server.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decoding %s body %q: %v", path, raw, err)
	}
	return response.StatusCode, body
}

func itemsOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("body has no items array: %#v", body)
	}
	return items
}

// ── Listing ─────────────────────────────────────────────────────────────────

func TestListGamesReturnsAPageAndACursor(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"?limit=2")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	items := itemsOf(t, body)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["slug"] != "one-move" {
		t.Fatalf("first slug = %v, want the newest game", first["slug"])
	}
	// The handler must ask the client for one row more than the page, which is
	// the only way it can know a further page exists without a COUNT.
	if backend.lastQuery.Limit != 2 {
		t.Fatalf("limit requested = %d, want 2", backend.lastQuery.Limit)
	}
	if backend.lastQuery.Search != "" || backend.lastQuery.CategoryID != "" {
		t.Fatalf("an unfiltered listing must send no filter, got %+v", backend.lastQuery)
	}

	cursor, _ := body["nextCursor"].(string)
	if cursor == "" {
		t.Fatal("nextCursor is empty, want a cursor for the second page")
	}

	// The cursor must be the last row of the page that was just served, so the
	// next request resumes after it rather than repeating it.
	status, second := get(t, server, GamesPath+"?limit=2&cursor="+cursor)
	if status != http.StatusOK {
		t.Fatalf("second page status = %d, want 200", status)
	}
	if !backend.lastQuery.HasAfter {
		t.Fatal("the cursor was not applied to the query")
	}
	if backend.lastQuery.AfterID != olderID {
		t.Fatalf("cursor id = %q, want the last row of the first page (%q)", backend.lastQuery.AfterID, olderID)
	}
	if !backend.lastQuery.AfterPublishedAt.Equal(backend.games[1].PublishedAt.UTC()) {
		t.Fatalf("cursor timestamp = %v, want %v", backend.lastQuery.AfterPublishedAt, backend.games[1].PublishedAt)
	}
	if len(itemsOf(t, second)) != 2 {
		t.Fatalf("second page items = %d, want 2", len(itemsOf(t, second)))
	}
}

func TestListGamesLastPageHasNoCursor(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(itemsOf(t, body)) != 3 {
		t.Fatalf("items = %d, want 3", len(itemsOf(t, body)))
	}
	if body["nextCursor"] != nil {
		t.Fatalf("nextCursor = %v, want null on the last page", body["nextCursor"])
	}
}

func TestListGamesEmptyCatalogueIsAnEmptyPage(t *testing.T) {
	backend := testBackend()
	backend.games = nil
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if items := itemsOf(t, body); len(items) != 0 {
		t.Fatalf("items = %d, want 0", len(items))
	}
	if body["nextCursor"] != nil {
		t.Fatalf("nextCursor = %v, want null", body["nextCursor"])
	}
}

func TestListGamesUnknownCategoryIsAnEmptyPageNotAnError(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"?category=strategy")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a well-formed slug that names nothing is a valid question", status)
	}
	if items := itemsOf(t, body); len(items) != 0 {
		t.Fatalf("items = %d, want 0", len(items))
	}
	// The listing must not run at all: there is no id to filter by, and running
	// it would return the whole catalogue under a category URL.
	if backend.listCalls != 0 {
		t.Fatalf("the listing ran %d times for an unknown category, want 0", backend.listCalls)
	}
}

func TestListGamesFiltersByCategory(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?category=puzzle&limit=5")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if backend.lastQuery.CategoryID != backend.categoryIDs["puzzle"] {
		t.Fatalf("category filter = %q, want the resolved id", backend.lastQuery.CategoryID)
	}
}

func TestListGamesSanitisesTheSearchTerm(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?q=stack%2C10)%2A")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if backend.lastQuery.Search != "stack10" {
		t.Fatalf("search term = %q, want the filter grammar stripped", backend.lastQuery.Search)
	}
}

func TestListGamesRejectsInvalidParameters(t *testing.T) {
	tests := map[string]string{
		"limit below range":    GamesPath + "?limit=0",
		"limit above range":    GamesPath + "?limit=101",
		"limit not a number":   GamesPath + "?limit=lots",
		"negative limit":       GamesPath + "?limit=-3",
		"unsupported sort":     GamesPath + "?sort=trending",
		"popular sort":         GamesPath + "?sort=popular",
		"malformed category":   GamesPath + "?category=Puzzle",
		"too short category":   GamesPath + "?category=p",
		"search with no words": GamesPath + "?q=***",
		"cursor is not base64": GamesPath + "?cursor=not-a-cursor",
		"cursor of the wrong version": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v9|2026-01-01T00:00:00Z|"+publishedID)),
		"cursor with a bad id": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v1|2026-01-01T00:00:00Z|not-a-uuid")),
		"cursor with a bad date": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v1|yesterday|"+publishedID)),
	}

	for name, path := range tests {
		t.Run(name, func(t *testing.T) {
			server := testServer(t, testBackend())
			status, body := get(t, server, path)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "bad_request" {
				t.Fatalf("code = %v, want bad_request", failure["code"])
			}
			details, _ := failure["details"].([]any)
			if len(details) == 0 {
				t.Fatal("the failure names no field, so a client cannot tell which parameter was wrong")
			}
		})
	}
}

func TestUnsupportedSortIsRefusedAndExplainsWhy(t *testing.T) {
	server := testServer(t, testBackend())

	_, body := get(t, server, GamesPath+"?sort=popular")
	failure, _ := body["error"].(map[string]any)
	message, _ := failure["message"].(string)
	// The refusal has to say that the ranking is missing rather than pretend the
	// value is a typo: nothing in this project can compute popularity yet.
	if !strings.Contains(message, "play data") {
		t.Fatalf("message = %q, want it to explain that popularity needs play data", message)
	}
}

// ── Detail ──────────────────────────────────────────────────────────────────

func TestGetGameReturnsThePublishedRecord(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath+"/stack-10")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["slug"] != "stack-10" || body["title"] != "Stack 10" {
		t.Fatalf("body = %#v, want the stack-10 record", body)
	}
	category, _ := body["category"].(map[string]any)
	if category["slug"] != "puzzle" {
		t.Fatalf("category = %#v, want puzzle", category)
	}
	// The embedded reference is a link target, not a category listing: it may not
	// carry a count, because a game response does not count anything.
	if len(category) != 2 {
		t.Fatalf("embedded category = %#v, want only slug and name", category)
	}
	if _, ok := category["gameCount"]; ok {
		t.Fatalf("embedded category carries a count: %#v", category)
	}
}

func TestGetGameAnswers404ForAnUnknownSlug(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath+"/never-made")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
	failure, _ := body["error"].(map[string]any)
	if failure["code"] != "not_found" {
		t.Fatalf("code = %v, want not_found", failure["code"])
	}
}

func TestGetGameRejectsAMalformedSlug(t *testing.T) {
	for _, slug := range []string{"Stack-10", "a", strings.Repeat("x", 60)} {
		t.Run(slug, func(t *testing.T) {
			server := testServer(t, testBackend())
			status, body := get(t, server, GamesPath+"/"+slug)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %q", status, slug)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "bad_request" {
				t.Fatalf("code = %v, want bad_request", failure["code"])
			}
		})
	}
}

// TestGameResponseCarriesNoFabricatedMetrics is the guard the whole phase turns
// on. Play counts, likes, comments, saves, ratings, average session time and
// rankings cannot be derived from stored activity — no service records any of
// them yet — so a response that carries one is carrying an invention. The field
// set is asserted exactly, which also means a new field has to be a deliberate
// decision rather than a side effect of adding a database column.
func TestGameResponseCarriesNoFabricatedMetrics(t *testing.T) {
	server := testServer(t, testBackend())

	_, body := get(t, server, GamesPath+"/stack-10")
	want := map[string]bool{
		"slug": true, "title": true, "tagline": true, "description": true,
		"instructions": true, "category": true, "runtime": true, "playable": true,
		"isOfficial": true, "coverPath": true, "publishedAt": true, "updatedAt": true,
	}
	for key := range body {
		if !want[key] {
			t.Errorf("unexpected field %q in a game response", key)
		}
	}
	for key := range want {
		if _, ok := body[key]; !ok {
			t.Errorf("missing field %q in a game response", key)
		}
	}

	// A game with no runtime must say so rather than imply it can be played.
	if body["playable"] != false {
		t.Errorf("playable = %v, want false while no runtime exists", body["playable"])
	}
	if body["runtime"] != nil {
		t.Errorf("runtime = %v, want null while no runtime exists", body["runtime"])
	}
}

// ── Categories ──────────────────────────────────────────────────────────────

func TestCategoriesReturnRealCounts(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, CategoriesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	items := itemsOf(t, body)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["slug"] != "puzzle" || first["gameCount"] != float64(2) {
		t.Fatalf("first category = %#v, want puzzle with a real count", first)
	}
	// A category with no published game is present with a zero, which is an
	// answer: the category exists and holds nothing yet.
	second, _ := items[1].(map[string]any)
	if second["gameCount"] != float64(0) {
		t.Fatalf("second category count = %v, want 0", second["gameCount"])
	}
}

// ── Failure modes ───────────────────────────────────────────────────────────

func TestRoutesWithoutConfigurationAnswer503(t *testing.T) {
	server := testServer(t, nil)

	for _, path := range []string{GamesPath, GamesPath + "/stack-10", CategoriesPath} {
		t.Run(path, func(t *testing.T) {
			status, body := get(t, server, path)
			if status != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", status)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "service_unavailable" {
				t.Fatalf("code = %v, want service_unavailable", failure["code"])
			}
			// The message must not name an environment variable or carry a value.
			message, _ := failure["message"].(string)
			if strings.Contains(message, "SUPABASE") {
				t.Fatalf("message %q names configuration", message)
			}
		})
	}
}

func TestUpstreamFailureIsUnavailableWithoutLeaking(t *testing.T) {
	backend := testBackend()
	backend.err = &supabasegames.Error{Op: "list-games", Status: 500, Code: "XX000"}

	server := testServer(t, backend)
	status, body := get(t, server, GamesPath)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	failure, _ := body["error"].(map[string]any)
	message, _ := failure["message"].(string)
	for _, leaked := range []string{"list-games", "XX000", "supabase", "500"} {
		if strings.Contains(message, leaked) {
			t.Fatalf("message %q leaked upstream detail %q", message, leaked)
		}
	}
}

func TestNotConfiguredDoesNotLeakConfiguration(t *testing.T) {
	// A nil backend is the "no Supabase credentials" deployment: the routes must
	// still answer, and refuse, in a language a user can act on.
	server := testServer(t, nil)
	_, body := get(t, server, GamesPath)
	failure, _ := body["error"].(map[string]any)
	if failure["message"] != "The game catalogue is not available right now." {
		t.Fatalf("message = %v", failure["message"])
	}
}

// ── Cursor round-trip ───────────────────────────────────────────────────────

func TestCursorRoundTripsTheSortKey(t *testing.T) {
	stamp := time.Date(2026, 9, 16, 12, 0, 0, 123456000, time.UTC)
	game := supabasegames.Game{ID: publishedID, PublishedAt: &stamp}

	cursor := nextCursor(game)
	if cursor == "" {
		t.Fatal("nextCursor returned an empty cursor for a published game")
	}
	after, id, err := decodeCursor(cursor)
	if err != nil {
		t.Fatalf("decodeCursor: %v", err)
	}
	if !after.Equal(stamp) {
		t.Fatalf("decoded timestamp = %v, want %v", after, stamp)
	}
	if id != publishedID {
		t.Fatalf("decoded id = %q, want %q", id, publishedID)
	}
	// The cursor is opaque, not structured JSON a client could build itself.
	if cursor == "" || strings.ContainsAny(cursor, "|\"'") {
		t.Fatalf("cursor %q must be opaque", cursor)
	}
}

func TestCursorIsNotEmittedForAGameWithNoPublicationTimestamp(t *testing.T) {
	if cursor := nextCursor(supabasegames.Game{ID: publishedID}); cursor != "" {
		t.Fatalf("cursor = %q, want none: a row with no timestamp cannot be resumed from", cursor)
	}
}

func TestParseListQueryDefaults(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, GamesPath, nil)
	query, err := parseListQuery(request)
	if err != nil {
		t.Fatalf("parseListQuery: %v", err)
	}
	if query.Limit != defaultPageLimit {
		t.Fatalf("limit = %d, want the documented default %d", query.Limit, defaultPageLimit)
	}
	if query.HasAfter || query.Search != "" || query.CategorySlug != "" {
		t.Fatalf("an empty query must apply no filter, got %+v", query)
	}
}

func TestParseListQueryAcceptsASupportedSort(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, GamesPath+"?sort="+supportedSort, nil)
	if _, err := parseListQuery(request); err != nil {
		t.Fatalf("the documented sort value must be accepted: %v", err)
	}
}

func TestSearchTermRejectsOnlyStructuralCharacters(t *testing.T) {
	term, ok := supabasegames.SearchTerm("  Colour, Merge!  ")
	if !ok || term != "Colour Merge!" {
		t.Fatalf("SearchTerm = %q, %v; want the punctuation a user can type preserved", term, ok)
	}
	if _, ok := supabasegames.SearchTerm(" \t\n "); ok {
		t.Fatal("a term of only whitespace must report no searchable content")
	}
}

// guardedBackend counts how often the listing is reached, so a test can assert
// that a rejected request never touched the database.
type guardedBackend struct {
	fakeBackend
	calls int
}

func (b *guardedBackend) ListGames(_ context.Context, _ supabasegames.ListQuery) ([]supabasegames.Game, error) {
	b.calls++
	return nil, nil
}

func TestInvalidParametersNeverReachTheDatabase(t *testing.T) {
	backend := &guardedBackend{}
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?limit=1000")
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if backend.calls != 0 {
		t.Fatalf("the listing ran %d times for a rejected request, want 0", backend.calls)
	}
}

// ── Wiring ──────────────────────────────────────────────────────────────────

func TestOptionsWiresTheServiceName(t *testing.T) {
	options := Options()
	if options.Name != Name {
		t.Fatalf("Name = %q, want %q", options.Name, Name)
	}
	if options.RegisterWith == nil {
		t.Fatal("the service needs RegisterWith to mount its routes")
	}
}

func TestBackendInterfaceIsSatisfiedByTheSupabaseClient(t *testing.T) {
	// A compile-time assertion, kept in a test so a signature change surfaces
	// here rather than in every handler.
	var _ Backend = (*supabasegames.Client)(nil)
}
