// Package supabasegames is the games service's typed read client for the
// `public.games` catalogue surface it serves.
//
// Two properties shape it:
//
//   - **It only reads.** Phase 4B publishes the catalogue; creating and editing
//     games is a separate, unimplemented feature. Nothing here can write, so a
//     bug cannot mutate production content.
//   - **It presents the *publishable* key and no user token.** Every catalogue
//     endpoint is public, and the publishable key is what Supabase gives the
//     browser, so the Data API answers as the `anon` role and Row Level Security
//     decides what exists: an unpublished game is not filtered out by this
//     package, it is not in the response at all. The service therefore holds no
//     credential that could read a draft.
//
// The one thing every query has to get right is the response shape. PostgREST
// projects exactly the columns named in `select`, which is why the projections
// below are constants and `select=*` is never used: a column added to `games`
// later must not appear in a public response by accident.
package supabasegames

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/onemore/packages/go/platform/config"
)

// Postgres error codes the service maps onto its own responses. PostgREST
// passes the SQLSTATE through in `code`.
const (
	codeInsufficientPrivilege = "42501"
)

// maxBodyBytes bounds what is read from the Data API. The catalogue pages and a
// category list are far smaller than this.
const maxBodyBytes = 1 << 20

// PublishedOnly is the only game status a public catalogue query can return. It
// is a filter rather than a comment: `games_select_visible` already hides
// unpublished rows from the anonymous role, and naming the status here means the
// service's intent cannot silently change if that policy is ever relaxed.
const publishedStatus = "published"

// gameColumns is the projection every game query uses — exactly the fields the
// public API exposes, plus the embedded category name.
const gameColumns = "id,slug,title,tagline,description,instructions,cover_path,runtime,playable,is_official,published_at,updated_at,categories(slug,name)"

// gameOrder is the catalogue's ordering, newest first. `nullslast` keeps a
// published row that somehow carries no timestamp from jumping the queue, and
// `id` breaks ties so the order — and therefore the keyset cursor — is total.
const gameOrder = "published_at.desc.nullslast,id.desc"

// categoryCountColumns is the projection of the `category_game_counts` view.
const categoryCountColumns = "slug,name,description,sort_order,game_count"

// Category is a game's category, trimmed to what a screen renders.
type Category struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// Game is one published catalogue row as this service exposes it. It carries no
// play count, rating, score or comment total: none of those can be derived from
// stored activity yet (the sessions, scores and social services are not
// implemented), and inventing them is not an option.
type Game struct {
	// ID is the database key. It is used for cursor pagination, not for URLs —
	// slugs are the stable public identifier.
	ID string
	// Slug is the stable public identifier (`stack-10`).
	Slug        string
	Title       string
	Tagline     *string
	Description *string
	// Instructions is how to play. Null while a game has no written rules.
	Instructions *string
	// CoverPath is an object path inside the `game-assets` bucket, not a URL.
	CoverPath *string
	// Runtime names the client runtime that plays this game, or nil when none
	// exists. Playable is true only when a runtime actually does.
	Runtime    *string
	Playable   bool
	IsOfficial bool
	// PublishedAt is the publication timestamp the catalogue orders by.
	PublishedAt *time.Time
	UpdatedAt   time.Time
	// Category is nil when a game has no category; the UI renders nothing rather
	// than an invented one.
	Category *Category
}

// CategoryCount is one row of the `category_game_counts` view: a real category
// and the real number of published games in it. A category with no published
// game is present with a zero count, which is an answer and not an absence.
type CategoryCount struct {
	Slug        string
	Name        string
	Description *string
	SortOrder   int
	GameCount   int64
}

// ListQuery describes one catalogue page.
//
// Limit is the number of rows the caller wants to *show*. The client requests
// `Limit+1` and returns up to that many, because a single extra row is how the
// caller learns another page exists without a second round trip or a COUNT.
//
// The remaining fields are filters. A zero value means "not applied", so an
// unfiltered listing needs only a Limit.
type ListQuery struct {
	// Limit is the page size, 1..100.
	Limit int
	// CategoryID restricts the page to one category. The caller resolves the
	// slug (see CategoryID) because a slug is what the API accepts and an id is
	// what the foreign key stores.
	CategoryID string
	// Search is a case-insensitive substring match over title, tagline and
	// description. It must already be sanitised (see SearchTerm).
	Search string
	// AfterID and AfterPublishedAt are the keyset cursor: the last row of the
	// previous page. HasAfter is false for the first page. An explicit flag
	// rather than a nil check keeps "cursor at the zero time" expressible.
	AfterID          string
	AfterPublishedAt time.Time
	HasAfter         bool
}

// ListGames reads one page of published games.
//
// It returns at most `query.Limit + 1` rows: when the result has more than
// `query.Limit` entries the caller knows another page exists and builds the next
// cursor from the last row it keeps.
func (c *Client) ListGames(ctx context.Context, query ListQuery) ([]Game, error) {
	if query.Limit < 1 {
		return nil, errors.New("a catalogue page needs a positive limit")
	}

	params := url.Values{}
	params.Set("select", gameColumns)
	params.Set("status", "eq."+publishedStatus)
	params.Set("order", gameOrder)
	params.Set("limit", strconv.Itoa(query.Limit+1))
	if query.CategoryID != "" {
		params.Set("category_id", "eq."+query.CategoryID)
	}

	// PostgREST accepts one top-level logic tree per request, so the keyset
	// cursor and the search are combined into a single `and(...)` rather than
	// sent as two parameters that would overwrite each other.
	keyset := cursorFilter(query)
	search := searchFilter(query.Search)
	switch {
	case keyset != "" && search != "":
		params.Set("and", "("+keyset+","+search+")")
	case keyset != "":
		params.Set("or", "("+keyset+")")
	case search != "":
		params.Set("or", "("+search+")")
	}

	rows, err := getRows[row](c, ctx, "list-games", "/rest/v1/games?"+params.Encode())
	if err != nil {
		return nil, err
	}

	games := make([]Game, 0, len(rows))
	for _, row := range rows {
		games = append(games, row.game())
	}
	return games, nil
}

// GetGame reads one published game by slug. `found` is false when no published
// game has that slug, which is a 404 for the caller — not an error.
//
// The `status` filter is what makes an unpublished game indistinguishable from a
// missing one: RLS would hide it anyway, and asking for it by slug must not
// become a way to learn that a draft exists.
func (c *Client) GetGame(ctx context.Context, slug string) (Game, bool, error) {
	if slug == "" {
		return Game{}, false, errors.New("a game lookup needs a slug")
	}

	params := url.Values{}
	params.Set("select", gameColumns)
	params.Set("slug", "eq."+slug)
	params.Set("status", "eq."+publishedStatus)
	params.Set("limit", "1")

	rows, err := getRows[row](c, ctx, "read-game", "/rest/v1/games?"+params.Encode())
	if err != nil {
		return Game{}, false, err
	}
	if len(rows) == 0 {
		return Game{}, false, nil
	}
	return rows[0].game(), true, nil
}

// CategoryID resolves a category slug to the id the `games.category_id` foreign
// key stores. `found` is false for an unknown slug, which the caller turns into
// an empty page rather than an error: a well-formed slug that names nothing is
// not a malformed request.
func (c *Client) CategoryID(ctx context.Context, slug string) (string, bool, error) {
	if slug == "" {
		return "", false, errors.New("a category lookup needs a slug")
	}

	params := url.Values{}
	params.Set("select", "id")
	params.Set("slug", "eq."+slug)
	params.Set("limit", "1")

	rows, err := getRows[categoryRow](c, ctx, "read-category-id", "/rest/v1/categories?"+params.Encode())
	if err != nil {
		return "", false, err
	}
	if len(rows) == 0 {
		return "", false, nil
	}
	return rows[0].ID, true, nil
}

// CategoryCounts reads every category with its real published-game count.
//
// The count comes from a database view rather than a loop of per-category
// queries, so one screen is one request and the number is computed by the same
// engine that stores the rows. The view's `status = 'published'` filter is
// inside its definition, which is why a draft never contributes to a count.
func (c *Client) CategoryCounts(ctx context.Context) ([]CategoryCount, error) {
	params := url.Values{}
	params.Set("select", categoryCountColumns)
	params.Set("order", "sort_order.asc,slug.asc")

	rows, err := getRows[categoryCountRow](c, ctx, "list-categories", "/rest/v1/category_game_counts?"+params.Encode())
	if err != nil {
		return nil, err
	}

	counts := make([]CategoryCount, 0, len(rows))
	for _, row := range rows {
		counts = append(counts, CategoryCount{
			Slug:        row.Slug,
			Name:        row.Name,
			Description: row.Description,
			SortOrder:   row.SortOrder,
			GameCount:   row.GameCount,
		})
	}
	return counts, nil
}

// SearchTerm normalises a user's search box into something the PostgREST filter
// grammar cannot misinterpret, and reports whether anything searchable is left.
//
// PostgREST's `or=(...)` tree uses `,` `(` `)` and `*` as structure, and a term
// containing one of them would change the query rather than search for it. They
// are dropped instead of escaped: a literal comma is not worth a filter-injection
// surface. `*` is dropped too, so a user cannot widen their own search into a
// full-table wildcard. The result is trimmed and length-limited by the caller.
func SearchTerm(raw string) (string, bool) {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case ',', '(', ')', '*', '"', '\\', '\n', '\r', '\t':
			return -1
		}
		return r
	}, raw)
	cleaned = strings.TrimSpace(cleaned)
	return cleaned, cleaned != ""
}

// cursorFilter builds the "rows after this one" condition for the keyset cursor:
// a strictly older `published_at`, or the same timestamp with a lower `id`. The
// two halves must be inside one `and(...)` — a bare `or` of them would match
// every older row regardless of id.
func cursorFilter(query ListQuery) string {
	if !query.HasAfter || query.AfterID == "" {
		return ""
	}
	stamp := query.AfterPublishedAt.UTC().Format(time.RFC3339Nano)
	return fmt.Sprintf("published_at.lt.%s,and(published_at.eq.%s,id.lt.%s)", stamp, stamp, query.AfterID)
}

// searchFilter builds the case-insensitive substring match over the three text
// columns a person would expect a game search to cover.
func searchFilter(term string) string {
	if term == "" {
		return ""
	}
	pattern := "ilike.*" + term + "*"
	parts := make([]string, 0, 3)
	for _, column := range []string{"title", "tagline", "description"} {
		parts = append(parts, column+"."+pattern)
	}
	return strings.Join(parts, ",")
}

// ── Transport ───────────────────────────────────────────────────────────────

// Client reads the catalogue through Supabase's Data API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds the client. It refuses to start without the project URL and the
// publishable key, because a client that cannot authenticate its calls would
// only turn into a confusing failure per request.
func New(cfg *config.Config) (*Client, error) {
	if !cfg.HasAuthAPI() {
		return nil, errors.New("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to read the catalogue")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		apiKey:  cfg.Supabase.PublishableKey,
		// Bounded so a slow database never holds a request open.
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// row is the on-the-wire shape of a game, which is not the shape the API
// exposes: the database's snake_case names, the embedded category and the uuid
// stay here, and `game()` maps them onto the public view. A `categories` embed
// for a game with no category is absent, which decodes to nil.
type row struct {
	ID           string       `json:"id"`
	Slug         string       `json:"slug"`
	Title        string       `json:"title"`
	Tagline      *string      `json:"tagline"`
	Description  *string      `json:"description"`
	Instructions *string      `json:"instructions"`
	CoverPath    *string      `json:"cover_path"`
	Runtime      *string      `json:"runtime"`
	Playable     bool         `json:"playable"`
	IsOfficial   bool         `json:"is_official"`
	PublishedAt  *time.Time   `json:"published_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	Category     *categoryRow `json:"categories"`
}

type categoryRow struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// categoryCountRow is one `category_game_counts` row.
type categoryCountRow struct {
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	SortOrder   int     `json:"sort_order"`
	GameCount   int64   `json:"game_count"`
}

func (r row) game() Game {
	game := Game{
		ID:           r.ID,
		Slug:         r.Slug,
		Title:        r.Title,
		Tagline:      r.Tagline,
		Description:  r.Description,
		Instructions: r.Instructions,
		CoverPath:    r.CoverPath,
		Runtime:      r.Runtime,
		Playable:     r.Playable,
		IsOfficial:   r.IsOfficial,
		PublishedAt:  r.PublishedAt,
		UpdatedAt:    r.UpdatedAt,
	}
	if r.Category != nil {
		game.Category = &Category{Slug: r.Category.Slug, Name: r.Category.Name}
	}
	return game
}

// Error is a failed Data API call. It is safe to log: it carries the operation,
// the HTTP status PostgREST answered with (0 when the call never completed), the
// machine-readable SQLSTATE or PostgREST code, and the transport error — never
// the response body, which can echo caller-supplied text.
type Error struct {
	Op     string
	Status int
	Code   string
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("supabase games %s: request failed (%v)", e.Op, e.cause)
	}
	if e.Code != "" {
		return fmt.Sprintf("supabase games %s: status %d code %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("supabase games %s: status %d", e.Op, e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// IsForbidden reports whether the database refused the read on privilege
// grounds. For this service that means the publishable key is wrong or the
// catalogue grants have regressed, which is a deployment fault, not a caller
// mistake.
func (e *Error) IsForbidden() bool {
	return e.Status == http.StatusForbidden || e.Code == codeInsufficientPrivilege
}

// getRows performs a GET and decodes the JSON array PostgREST returns. It is a
// free function rather than a method because Go methods cannot have type
// parameters, and every projection decodes into its own row shape.
func getRows[T any](c *Client, ctx context.Context, op, path string) ([]T, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "onemore-games-service")
	// Deliberately no Authorization header. The publishable key identifies the
	// project and nothing more, so the request is answered as `anon` and RLS is
	// the only thing deciding what comes back.

	response, err := c.http.Do(request)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code, _ := errorCode(response.Body)
		return nil, &Error{Op: op, Status: response.StatusCode, Code: code}
	}

	var rows []T
	if err := decodeJSON(response.Body, &rows); err != nil {
		return nil, &Error{Op: op, Status: response.StatusCode, cause: err}
	}
	return rows, nil
}

// errorEnvelope covers PostgREST's error shape.
type errorEnvelope struct {
	Code string `json:"code"`
}

// errorCode reads only the machine-readable code. PostgREST's `message` and
// `details` can echo the caller's own input or describe the schema, so they are
// deliberately dropped rather than carried into a log line or a response.
func errorCode(body io.Reader) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return "", err
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", err
	}
	if len(envelope.Code) > 32 {
		return "", nil
	}
	for _, r := range envelope.Code {
		if !(r >= '0' && r <= '9') && !(r >= 'A' && r <= 'Z') && !(r >= 'a' && r <= 'z') && r != '_' {
			return "", nil
		}
	}
	return envelope.Code, nil
}

func decodeJSON(body io.Reader, dst any) error {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return errors.New("supabase returned a body that could not be decoded")
	}
	return nil
}
