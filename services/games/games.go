// Package games defines the Games service: the public catalogue of published
// games and their categories.
//
// What it serves, and what it deliberately does not:
//
//   - **Three public read endpoints.** `GET /api/v1/games` (a page of published
//     games, filterable by category and by a text search), `GET
//     /api/v1/games/{slug}` (one published game) and `GET /api/v1/categories`
//     (every category with its real count of published games). None of them
//     needs a token: the catalogue is public, and the database's RLS policies
//     already hide everything unpublished from the anonymous role.
//   - **No fabricated metrics.** There is no play count, like total, comment
//     total, average session, rating or ranking in any response, because none of
//     them can be derived from stored activity yet — the sessions, scores and
//     social services are not implemented. A field invented here would be
//     indistinguishable from a real one on screen, so the field is simply absent
//     and the UI renders nothing rather than a zero.
//   - **No "popular" or "trending" ordering.** Both need play data. The only
//     ordering the catalogue can honestly offer is recency, which is why `sort`
//     accepts exactly one value.
//
// The slug is the public identifier (`/api/v1/games/stack-10`), matching the
// web app's stable URLs. A game's uuid is internal and never appears in a
// response.
package games

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/onemore/packages/go/platform/apierr"
	"github.com/r1jadi/onemore/packages/go/platform/authn"
	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/games/internal/supabasegames"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

// Name is the service name used in logs, configuration validation and the
// SERVICE_NAME default.
const Name = "games"

// The routes this service publishes. They are constants so the contract, the
// tests, the gateway's route table and the README cannot drift from the router.
const (
	// GamesPath lists the catalogue.
	GamesPath = "/api/v1/games"
	// GamePath reads one game. The identifier is the game's slug, not its uuid.
	GamePath = "/api/v1/games/{slug}"
	// CategoriesPath lists categories with their real published-game counts.
	CategoriesPath = "/api/v1/categories"
)

const (
	defaultPageLimit = 20
	maxPageLimit     = 100
	// maxSearchRunes bounds a search box. Longer than any real query, short
	// enough that the pattern cannot become a denial-of-service.
	maxSearchRunes = 100
	// maxCursorLength matches the contract's `cursor` schema.
	maxCursorLength = 200
	// cursorPrefix versions the cursor payload, so a future change to its shape
	// can be told apart from a malformed one instead of misread as a date.
	cursorPrefix = "v1"
)

// supportedSort is the only ordering the catalogue can compute from real data.
// `popular` and `trending` are absent on purpose: they need play counts, and no
// service records plays yet. Naming the single value (rather than dropping the
// parameter) keeps the refusal explicit and testable.
const supportedSort = "latest"

// Patterns mirror the database constraints exactly. The database stays the
// authority; these exist so a bad request is a 400 that names the field instead
// of a 500 from a constraint.
var (
	categorySlugPattern = regexp.MustCompile(`^[a-z0-9-]{2,32}$`)
	gameSlugPattern     = regexp.MustCompile(`^[a-z0-9-]{2,48}$`)
	uuidPattern         = regexp.MustCompile(`^[0-9a-f-]{36}$`)
)

// Backend is the catalogue surface this service needs. It is an interface so the
// handlers are tested without a network, and so a deployment that has not been
// given Supabase credentials can still boot, serve its probes, and answer 503 on
// the catalogue routes instead of crash-looping.
type Backend interface {
	ListGames(ctx context.Context, query supabasegames.ListQuery) ([]supabasegames.Game, error)
	GetGame(ctx context.Context, slug string) (supabasegames.Game, bool, error)
	CategoryID(ctx context.Context, slug string) (string, bool, error)
	CategoryCounts(ctx context.Context) ([]supabasegames.CategoryCount, error)
}

// ── Response shapes ─────────────────────────────────────────────────────────
//
// The API's view of a game is assembled field by field rather than by
// re-encoding the database row, so a column added to `games` later cannot appear
// in a response by accident — that is also why there is no `id`, `status` or
// `ownerId` here. Optional fields are pointers without `omitempty`: they are
// always present and `null` means "there is none", which a client can tell apart
// from a missing field.

type categoryView struct {
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// GameCount is the real number of published games in this category.
	GameCount int64 `json:"gameCount"`
}

// categoryRefView is the trimmed category a game embeds: a slug to link by and
// a name to render. It is deliberately a different type from categoryView — a
// game response must not carry a `gameCount`, because it did not count one, and
// a zero standing in for "not measured here" reads as a real measurement.
// Counts belong to `/categories`, where they are computed in the database.
type categoryRefView struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type gameView struct {
	Slug         string           `json:"slug"`
	Title        string           `json:"title"`
	Tagline      *string          `json:"tagline"`
	Description  *string          `json:"description"`
	Instructions *string          `json:"instructions"`
	Category     *categoryRefView `json:"category"`
	// Runtime names the client runtime that plays this game, or null when none
	// exists. Playable is false for every game today.
	Runtime    *string `json:"runtime"`
	Playable   bool    `json:"playable"`
	IsOfficial bool    `json:"isOfficial"`
	// CoverPath is a storage object path under the `game-assets` bucket, not a
	// URL: the client builds the public URL, exactly as it does for avatars.
	CoverPath   *string    `json:"coverPath"`
	PublishedAt *time.Time `json:"publishedAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func categoryRef(category *supabasegames.Category) *categoryRefView {
	if category == nil {
		return nil
	}
	return &categoryRefView{Slug: category.Slug, Name: category.Name}
}

func view(game supabasegames.Game) gameView {
	return gameView{
		Slug:         game.Slug,
		Title:        game.Title,
		Tagline:      game.Tagline,
		Description:  game.Description,
		Instructions: game.Instructions,
		Category:     categoryRef(game.Category),
		Runtime:      game.Runtime,
		Playable:     game.Playable,
		IsOfficial:   game.IsOfficial,
		CoverPath:    game.CoverPath,
		PublishedAt:  game.PublishedAt,
		UpdatedAt:    game.UpdatedAt,
	}
}

type gameListResponse struct {
	Items []gameView `json:"items"`
	// NextCursor is null on the last page. It is opaque to clients and is what
	// makes paging stable while games are published between requests.
	NextCursor *string `json:"nextCursor"`
}

// ── Handlers ────────────────────────────────────────────────────────────────

// service holds the handlers' dependencies. `backend` is nil when the deployment
// has no Supabase credentials, which is a diagnosable state rather than a crash.
type service struct {
	backend Backend
	logger  *slog.Logger
}

func newService(backend Backend, logger *slog.Logger) *service {
	if logger == nil {
		logger = slog.Default()
	}
	return &service{backend: backend, logger: logger}
}

// register mounts the routes. The three catalogue reads are public; the
// not-yet-built write endpoints stay registered so the published contract and
// the router agree and a client gets a documented 501 rather than a 404.
func (s *service) register(router *httpx.Router) {
	router.PublicFunc("GET "+GamesPath, s.listGames)
	router.PublicFunc("GET "+GamePath, s.getGame)
	router.PublicFunc("GET "+CategoriesPath, s.listCategories)

	router.AuthenticatedFunc("POST "+GamesPath, httpx.NotImplemented(Name, "Creating a game"))
	router.AuthenticatedFunc("PATCH "+GamePath, httpx.NotImplemented(Name, "Updating an owned game"))
	router.AuthenticatedFunc("POST "+GamePath+"/publish", httpx.NotImplemented(Name, "Submitting a game for review"))
}

func (s *service) listGames(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "browse the catalogue")
		return
	}

	query, failure := parseListQuery(r)
	if failure != nil {
		httpx.WriteError(w, r, failure)
		return
	}

	if query.CategorySlug != "" {
		id, found, err := s.backend.CategoryID(r.Context(), query.CategorySlug)
		if err != nil {
			s.dataFailure(w, r, "resolve a category", err)
			return
		}
		// A well-formed slug that names no category is an empty result, not an
		// error: the caller asked a valid question and the answer is "none".
		if !found {
			httpx.WriteJSON(w, r, http.StatusOK, gameListResponse{Items: []gameView{}})
			return
		}
		query.CategoryID = id
	}

	games, err := s.backend.ListGames(r.Context(), query.ListQuery)
	if err != nil {
		s.dataFailure(w, r, "list games", err)
		return
	}

	// The client fetched one row more than the page size, so a longer result is
	// exactly the signal that another page exists.
	limit := query.Limit
	items := make([]gameView, 0, min(len(games), limit))
	for _, game := range games[:min(len(games), limit)] {
		items = append(items, view(game))
	}

	var next *string
	if len(games) > limit {
		if cursor := nextCursor(games[limit-1]); cursor != "" {
			next = &cursor
		}
	}
	httpx.WriteJSON(w, r, http.StatusOK, gameListResponse{Items: items, NextCursor: next})
}

func (s *service) getGame(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "read a game")
		return
	}

	slug := strings.TrimSpace(r.PathValue("slug"))
	// The pattern is checked before the database so an obviously malformed path
	// is a 400 and a well-formed but unknown one is a 404 — two different
	// answers, and the caller can tell which mistake they made.
	if !gameSlugPattern.MatchString(slug) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid game slug.",
			apierr.Detail{Field: "slug", Rule: "format"}))
		return
	}

	game, found, err := s.backend.GetGame(r.Context(), slug)
	if err != nil {
		s.dataFailure(w, r, "read a game", err)
		return
	}
	if !found {
		// An unpublished game and a missing one are the same answer: telling
		// them apart would let a stranger enumerate drafts.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No such game."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, view(game))
}

func (s *service) listCategories(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "list categories")
		return
	}

	counts, err := s.backend.CategoryCounts(r.Context())
	if err != nil {
		s.dataFailure(w, r, "list categories", err)
		return
	}

	items := make([]categoryView, 0, len(counts))
	for _, count := range counts {
		items = append(items, categoryView{
			Slug:        count.Slug,
			Name:        count.Name,
			Description: count.Description,
			GameCount:   count.GameCount,
		})
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items []categoryView `json:"items"`
	}{Items: items})
}

// ── Query parsing ───────────────────────────────────────────────────────────

// listQuery is a catalogue page as the API describes it.
//
// CategorySlug is carried alongside the storage-level query because a slug is
// what the API accepts and an id is what the foreign key stores; the handler
// resolves one into the other before calling the backend, and a request that
// names no category never pays for that lookup.
type listQuery struct {
	supabasegames.ListQuery
	CategorySlug string
}

func parseListQuery(r *http.Request) (listQuery, error) {
	values := r.URL.Query()
	query := listQuery{ListQuery: supabasegames.ListQuery{Limit: defaultPageLimit}}

	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageLimit {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"limit must be a whole number between 1 and 100.",
				apierr.Detail{Field: "limit", Rule: "range"})
		}
		query.Limit = limit
	}

	if raw := strings.TrimSpace(values.Get("sort")); raw != "" && raw != supportedSort {
		return query, httpx.NewError(httpx.CodeBadRequest,
			"The catalogue can only be sorted by recency. Popular and trending need play data that does not exist yet.",
			apierr.Detail{Field: "sort", Rule: "unsupported"})
	}

	if raw := strings.TrimSpace(values.Get("category")); raw != "" {
		if !categorySlugPattern.MatchString(raw) {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That is not a valid category slug.",
				apierr.Detail{Field: "category", Rule: "format"})
		}
		query.CategorySlug = raw
	}

	if raw := strings.TrimSpace(values.Get("q")); raw != "" {
		if len([]rune(raw)) > maxSearchRunes {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"Search terms are limited to 100 characters.",
				apierr.Detail{Field: "q", Rule: "maxLength"})
		}
		term, ok := supabasegames.SearchTerm(raw)
		if !ok {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That search has no searchable characters.",
				apierr.Detail{Field: "q", Rule: "invalid"})
		}
		query.Search = term
	}

	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		if len(raw) > maxCursorLength {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "maxLength"})
		}
		after, id, err := decodeCursor(raw)
		if err != nil {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "format"})
		}
		query.AfterPublishedAt, query.AfterID, query.HasAfter = after, id, true
	}

	return query, nil
}

// ── Cursor ──────────────────────────────────────────────────────────────────
//
// The cursor is the sort key of the last row on the previous page: its
// publication timestamp and its id. Re-reading from that pair is what makes
// paging stable — a game published between two requests lands on a later page
// rather than shifting every following row and duplicating one.
//
// It is opaque (base64url over `v1|<timestamp>|<id>`) so a client cannot be
// tempted to construct one, and a malformed value is a clear 400 rather than a
// confusing empty page.

func nextCursor(game supabasegames.Game) string {
	// A published game always has a publication timestamp — publishing stamps it
	// in the database. If one somehow does not, it sorts last, so the listing
	// simply ends there instead of emitting a cursor that could not be re-read.
	if game.PublishedAt == nil {
		return ""
	}
	payload := strings.Join([]string{
		cursorPrefix,
		game.PublishedAt.UTC().Format(time.RFC3339Nano),
		game.ID,
	}, "|")
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

func decodeCursor(raw string) (time.Time, string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 3 || parts[0] != cursorPrefix {
		return time.Time{}, "", errors.New("cursor is not a catalogue cursor")
	}
	stamp, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return time.Time{}, "", err
	}
	if !uuidPattern.MatchString(parts[2]) {
		return time.Time{}, "", errors.New("cursor carries no usable id")
	}
	return stamp, parts[2], nil
}

// ── Failures ────────────────────────────────────────────────────────────────

// notConfigured answers a route whose Supabase dependency is missing. It names no
// variable and carries no value: the log line is where the operator finds out
// what to set.
func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "games dependency is not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
}

// dataFailure maps a Data API failure onto the platform's envelope.
//
// Only a message written here is ever sent. The database's own text can describe
// the schema, and a caller's search term can appear in it, so the machine-readable
// code decides the classification and the wording is ours.
func (s *service) dataFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabasegames.Error
	if errors.As(err, &dataErr) && dataErr.IsForbidden() {
		s.logger.ErrorContext(r.Context(), "the catalogue read was refused by the database",
			slog.String("operation", operation), slog.String("code", dataErr.Code))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
		return
	}

	s.logger.ErrorContext(r.Context(), "catalogue call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring every games entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabasegames.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the catalogue routes, which is far
				// more diagnosable than a crash loop. The error names the missing
				// variables and carries no value.
				logger.Warn("Supabase is not configured; the catalogue routes answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, logger).register(router)
		},
	}
}
