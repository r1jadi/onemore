// Package supabaseadmin is the admin service's typed client for the
// staff-gated functions in the database.
//
// One property defines this package, and it is the reason the admin surface is
// safe to build at all:
//
//   - **Every call carries the caller's own access token.** The `apikey` header
//     identifies the project; the `Authorization: Bearer` header identifies the
//     *caller*, and the Data API answers as that user. The functions behind these
//     calls run as their definer and therefore bypass Row Level Security, so the
//     token is not what makes them safe on its own — what makes them safe is that
//     each one derives the actor from `auth.uid()` and checks `public.is_staff()`
//     or `public.is_admin()` itself (see
//     supabase/migrations/20261013130000_admin_operations.sql).
//
// Two consequences follow, and both are deliberate:
//
//   - The service holds **no secret key**. There is no service-role credential in
//     this process, so a bug here cannot read a table that no policy allows: the
//     worst case is a call refused by the database.
//   - A refusal is the database's answer, not a check this package makes. A
//     non-staff caller gets PostgREST's translation of SQLSTATE `42501` — HTTP
//     403 — and this package reports it as a forbidden call. The Go layer's own
//     role check (in the service) exists to answer quickly and with a better
//     message, not because the database would otherwise allow the read.
package supabaseadmin

import (
	"bytes"
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

// PostgREST passes the SQLSTATE through in `code`. These are the ones the admin
// functions raise deliberately.
const (
	codeInsufficientPrivilege = "42501" // the staff/admin guard refused
	codeNoDataFound           = "P0002" // the row being moderated does not exist
	codeInvalidParameter      = "22023" // input the function's own validation refused
)

// maxBodyBytes bounds what is read from the Data API. A page of fifty directory
// rows is far smaller than this.
const maxBodyBytes = 1 << 20

// Client calls the staff-gated database functions.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds the client. It refuses to start without the project URL and the
// publishable key: a client that cannot authenticate its calls would turn every
// request into a confusing failure.
func New(cfg *config.Config) (*Client, error) {
	if !cfg.HasAuthAPI() {
		return nil, errors.New("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for the admin API")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		apiKey:  cfg.Supabase.PublishableKey,
		// Bounded so a slow database never holds an admin request open.
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// Identity is the caller's own role and account state, read from
// `public.user_roles` by the database. It is the authorization decision this
// service makes: a token's role claim is a hint, this row is the answer.
type Identity struct {
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	IsStaff     bool   `json:"isStaff"`
	IsAdmin     bool   `json:"isAdmin"`
	IsSuspended bool   `json:"isSuspended"`
}

// Identity reads the caller's role and account state.
func (c *Client) Identity(ctx context.Context, token string) (Identity, error) {
	var identity Identity
	if err := c.rpc(ctx, "identity", "admin_identity", nil, token, &identity); err != nil {
		return Identity{}, err
	}
	return identity, nil
}

// ── Dashboard reads ─────────────────────────────────────────────────────────

// SeriesPoint is one day of real activity.
type SeriesPoint struct {
	Day     string `json:"day"`
	Runs    int64  `json:"runs"`
	Scores  int64  `json:"scores"`
	Signups int64  `json:"signups"`
	Players int64  `json:"players"`
}

// Activity is one line of the overview feed. Every line corresponds to a row that
// exists: a moderation decision, a published game or a verified score.
type Activity struct {
	Kind        string    `json:"kind"`
	At          time.Time `json:"at"`
	Actor       string    `json:"actor"`
	Action      string    `json:"action"`
	SubjectKind string    `json:"subjectKind"`
	Subject     string    `json:"subject"`
	Href        *string   `json:"href"`
}

// TopGame is a game with real completed runs.
type TopGame struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Runs  int64  `json:"runs"`
}

// Overview is the dashboard's real numbers. A pointer field is a value that
// cannot be measured yet (`AvgRunSeconds` before the first completed run) and is
// `null` rather than zero.
type Overview struct {
	TotalUsers       int64         `json:"totalUsers"`
	ActiveUsers      int64         `json:"activeUsers"`
	Games            int64         `json:"games"`
	PublishedGames   int64         `json:"publishedGames"`
	PlayableGames    int64         `json:"playableGames"`
	GamesPlayed      int64         `json:"gamesPlayed"`
	RunsOpen         int64         `json:"runsOpen"`
	ScoresRecorded   int64         `json:"scoresRecorded"`
	Players          int64         `json:"players"`
	OpenReports      int64         `json:"openReports"`
	PendingReview    int64         `json:"pendingReview"`
	ReviewingReports int64         `json:"reviewingReports"`
	Comments         int64         `json:"comments"`
	HiddenComments   int64         `json:"hiddenComments"`
	NewUsersToday    int64         `json:"newUsersToday"`
	AvgRunSeconds    *float64      `json:"avgRunSeconds"`
	RunsMeasured     int64         `json:"runsMeasured"`
	Series           []SeriesPoint `json:"series"`
	Activity         []Activity    `json:"activity"`
	TopGames         []TopGame     `json:"topGames"`
}

// Overview reads the dashboard aggregate.
func (c *Client) Overview(ctx context.Context, token string) (Overview, error) {
	var overview Overview
	if err := c.rpc(ctx, "overview", "admin_overview", nil, token, &overview); err != nil {
		return Overview{}, err
	}
	return overview, nil
}

// TopPlayer is one player's real verified best.
type TopPlayer struct {
	Username     string     `json:"username"`
	BestScore    int64      `json:"bestScore"`
	Scores       int64      `json:"scores"`
	LastScoredAt *time.Time `json:"lastScoredAt"`
}

// AnalyticsGame is one game's real activity over the window.
type AnalyticsGame struct {
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	Runs      int64  `json:"runs"`
	Players   int64  `json:"players"`
	BestScore int64  `json:"bestScore"`
}

// Analytics is the platform's real activity aggregate over a window.
type Analytics struct {
	Days          int64           `json:"days"`
	TotalUsers    int64           `json:"totalUsers"`
	NewUsers      int64           `json:"newUsers"`
	Runs          int64           `json:"runs"`
	Players       int64           `json:"players"`
	Scores        int64           `json:"scores"`
	Comments      int64           `json:"comments"`
	AvgRunSeconds *float64        `json:"avgRunSeconds"`
	Series        []SeriesPoint   `json:"series"`
	TopGames      []AnalyticsGame `json:"topGames"`
	TopPlayers    []TopPlayer     `json:"topPlayers"`
}

// Analytics reads the platform aggregate for the last `days` days.
func (c *Client) Analytics(ctx context.Context, token string, days int) (Analytics, error) {
	var analytics Analytics
	payload := map[string]any{"p_days": days}
	if err := c.rpc(ctx, "analytics", "admin_analytics", payload, token, &analytics); err != nil {
		return Analytics{}, err
	}
	return analytics, nil
}

// ── Directories ─────────────────────────────────────────────────────────────

// Page is the paging every directory call shares. The service asks for one row
// more than the page so it can report whether another page exists without a
// COUNT, exactly as the catalogue does.
type Page struct {
	Limit  int
	Offset int
}

// Game is one row of the moderation directory.
type Game struct {
	ID            string     `json:"id"`
	Slug          string     `json:"slug"`
	Title         string     `json:"title"`
	Tagline       *string    `json:"tagline"`
	Status        string     `json:"status"`
	IsOfficial    bool       `json:"is_official"`
	Playable      bool       `json:"playable"`
	Runtime       *string    `json:"runtime"`
	CategorySlug  *string    `json:"category_slug"`
	CategoryName  *string    `json:"category_name"`
	OwnerUsername *string    `json:"owner_username"`
	Plays         int64      `json:"plays"`
	Players       int64      `json:"players"`
	BestScore     *int64     `json:"best_score"`
	Comments      int64      `json:"comments"`
	CreatedAt     time.Time  `json:"created_at"`
	PublishedAt   *time.Time `json:"published_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Games reads one page of the moderation directory. `status` and `search` are
// filters; an empty string means "not applied".
func (c *Client) Games(ctx context.Context, token, status, search string, page Page) ([]Game, error) {
	payload := map[string]any{
		"p_status": nullable(status),
		"p_search": nullable(search),
		"p_limit":  page.Limit + 1,
		"p_offset": page.Offset,
	}
	var rows []Game
	if err := c.rpc(ctx, "games", "admin_game_directory", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// User is one row of the account directory. It carries the two fields the Data
// API withholds from every other caller — the email and the suspension flag.
type User struct {
	ID             string     `json:"id"`
	Username       string     `json:"username"`
	DisplayName    string     `json:"display_name"`
	Email          *string    `json:"email"`
	Role           string     `json:"role"`
	IsSuspended    bool       `json:"is_suspended"`
	CreatedAt      time.Time  `json:"created_at"`
	LastActiveAt   *time.Time `json:"last_active_at"`
	Plays          int64      `json:"plays"`
	BestScore      *int64     `json:"best_score"`
	ReportsAgainst int64      `json:"reports_against"`
}

// Users reads one page of the account directory.
func (c *Client) Users(ctx context.Context, token, search, role string, page Page) ([]User, error) {
	payload := map[string]any{
		"p_search": nullable(search),
		"p_role":   nullable(role),
		"p_limit":  page.Limit + 1,
		"p_offset": page.Offset,
	}
	var rows []User
	if err := c.rpc(ctx, "users", "admin_user_directory", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Report is one row of the moderation queue, with its target already resolved.
type Report struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	TargetKind         string     `json:"target_kind"`
	TargetID           string     `json:"target_id"`
	TargetLabel        *string    `json:"target_label"`
	TargetDetail       *string    `json:"target_detail"`
	Reason             string     `json:"reason"`
	Details            *string    `json:"details"`
	ReporterUsername   string     `json:"reporter_username"`
	ResolvedByUsername *string    `json:"resolved_by_username"`
	CreatedAt          time.Time  `json:"created_at"`
	ResolvedAt         *time.Time `json:"resolved_at"`
}

// Reports reads one page of the moderation queue.
func (c *Client) Reports(ctx context.Context, token, status string, page Page) ([]Report, error) {
	payload := map[string]any{
		"p_status": nullable(status),
		"p_limit":  page.Limit + 1,
		"p_offset": page.Offset,
	}
	var rows []Report
	if err := c.rpc(ctx, "reports", "admin_report_directory", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Comment is one row of the comment moderation list, hidden ones included.
type Comment struct {
	ID             string    `json:"id"`
	Body           string    `json:"body"`
	AuthorUsername string    `json:"author_username"`
	GameSlug       string    `json:"game_slug"`
	GameTitle      string    `json:"game_title"`
	IsHidden       bool      `json:"is_hidden"`
	IsReply        bool      `json:"is_reply"`
	Likes          int64     `json:"likes"`
	Reports        int64     `json:"reports"`
	CreatedAt      time.Time `json:"created_at"`
}

// Comments reads one page of the comment moderation list. `state` is visible,
// hidden or all (empty means all).
func (c *Client) Comments(ctx context.Context, token, state, search string, page Page) ([]Comment, error) {
	payload := map[string]any{
		"p_state":  nullable(state),
		"p_search": nullable(search),
		"p_limit":  page.Limit + 1,
		"p_offset": page.Offset,
	}
	var rows []Comment
	if err := c.rpc(ctx, "comments", "admin_comment_directory", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Score is one verified score, with the run it was verified against.
type Score struct {
	ID             string     `json:"id"`
	GameSlug       string     `json:"game_slug"`
	GameTitle      string     `json:"game_title"`
	Username       string     `json:"username"`
	Score          int64      `json:"score"`
	SessionStarted *time.Time `json:"session_started_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Scores reads one page of verified scores.
func (c *Client) Scores(ctx context.Context, token, gameSlug, username string, page Page) ([]Score, error) {
	payload := map[string]any{
		"p_game_slug": nullable(gameSlug),
		"p_username":  nullable(username),
		"p_limit":     page.Limit + 1,
		"p_offset":    page.Offset,
	}
	var rows []Score
	if err := c.rpc(ctx, "scores", "admin_score_directory", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Category is one category with both of its real counts.
type Category struct {
	Slug           string  `json:"slug"`
	Name           string  `json:"name"`
	Description    *string `json:"description"`
	SortOrder      int     `json:"sort_order"`
	PublishedGames int64   `json:"published_games"`
	TotalGames     int64   `json:"total_games"`
}

// Categories reads every category with its real counts.
func (c *Client) Categories(ctx context.Context, token string) ([]Category, error) {
	var rows []Category
	if err := c.rpc(ctx, "categories", "admin_category_directory", nil, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ModerationAction is one entry of the audit trail.
type ModerationAction struct {
	ID                string    `json:"id"`
	ModeratorUsername string    `json:"moderator_username"`
	TargetKind        string    `json:"target_kind"`
	TargetID          string    `json:"target_id"`
	Action            string    `json:"action"`
	Reason            *string   `json:"reason"`
	CreatedAt         time.Time `json:"created_at"`
}

// ModerationLog reads one page of the audit trail.
func (c *Client) ModerationLog(ctx context.Context, token string, page Page) ([]ModerationAction, error) {
	payload := map[string]any{"p_limit": page.Limit + 1, "p_offset": page.Offset}
	var rows []ModerationAction
	if err := c.rpc(ctx, "moderation-log", "admin_moderation_log", payload, token, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// ── Moderation writes ───────────────────────────────────────────────────────

// ActionResult is what a moderation write answers with: what changed, and the
// audit action recorded for it.
type ActionResult struct {
	GameID         string  `json:"gameId"`
	ReportID       string  `json:"reportId"`
	CommentID      string  `json:"commentId"`
	UserID         string  `json:"userId"`
	Username       string  `json:"username"`
	PreviousStatus *string `json:"previousStatus"`
	Status         *string `json:"status"`
	Hidden         *bool   `json:"hidden"`
	Suspended      *bool   `json:"suspended"`
	Action         string  `json:"action"`
}

// SetGameStatus publishes, rejects, archives or returns a game to review.
func (c *Client) SetGameStatus(ctx context.Context, token, gameID, status, reason string) (ActionResult, error) {
	payload := map[string]any{
		"p_game_id": gameID,
		"p_status":  status,
		"p_reason":  nullable(reason),
	}
	var result ActionResult
	if err := c.rpc(ctx, "set-game-status", "admin_set_game_status", payload, token, &result); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

// SetReportStatus moves a report through its workflow.
func (c *Client) SetReportStatus(ctx context.Context, token, reportID, status, reason string) (ActionResult, error) {
	payload := map[string]any{
		"p_report_id": reportID,
		"p_status":    status,
		"p_reason":    nullable(reason),
	}
	var result ActionResult
	if err := c.rpc(ctx, "set-report-status", "admin_set_report_status", payload, token, &result); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

// SetCommentHidden hides or restores a comment.
func (c *Client) SetCommentHidden(ctx context.Context, token, commentID string, hidden bool, reason string) (ActionResult, error) {
	payload := map[string]any{
		"p_comment_id": commentID,
		"p_hidden":     hidden,
		"p_reason":     nullable(reason),
	}
	var result ActionResult
	if err := c.rpc(ctx, "set-comment-hidden", "admin_set_comment_hidden", payload, token, &result); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

// SetSuspension suspends or restores an account. The database refuses this to
// anyone but an administrator, and refuses it for the caller's own account.
func (c *Client) SetSuspension(ctx context.Context, token, userID string, suspended bool, reason string) (ActionResult, error) {
	payload := map[string]any{
		"p_user_id":   userID,
		"p_suspended": suspended,
		"p_reason":    nullable(reason),
	}
	var result ActionResult
	if err := c.rpc(ctx, "set-suspension", "admin_set_suspension", payload, token, &result); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

// ── Transport ───────────────────────────────────────────────────────────────

// rpc posts one named-argument call to a database function and decodes the
// answer. `payload` nil sends `{}`, which is what a function whose only argument
// has a default expects.
//
// The caller's token is required: a call without one would be answered as `anon`
// and refused by the function's own grant, which is a deployment bug, not a
// caller's mistake — so it is refused here instead of being sent.
func (c *Client) rpc(ctx context.Context, op, function string, payload any, token string, dst any) error {
	if token == "" {
		return &Error{Op: op, cause: errors.New("no caller token")}
	}

	body := []byte("{}")
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return &Error{Op: op, cause: err}
		}
		body = encoded
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/rest/v1/rpc/"+url.PathEscape(function), bytes.NewReader(body))
	if err != nil {
		return &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "onemore-admin-service")

	response, err := c.http.Do(request)
	if err != nil {
		return &Error{Op: op, cause: err}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code, _ := errorCode(response.Body)
		return &Error{Op: op, Status: response.StatusCode, Code: code}
	}
	if dst == nil {
		return nil
	}
	if err := decodeJSON(response.Body, dst); err != nil {
		return &Error{Op: op, Status: response.StatusCode, cause: err}
	}
	return nil
}

// Error is a failed Data API call. It carries the operation, the HTTP status
// PostgREST answered with and the SQLSTATE — never the response body, which can
// echo caller-supplied text.
type Error struct {
	Op     string
	Status int
	Code   string
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("supabase admin %s: request failed (%v)", e.Op, e.cause)
	}
	if e.Code != "" {
		return fmt.Sprintf("supabase admin %s: status %d code %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("supabase admin %s: status %d", e.Op, e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// IsForbidden reports whether the database refused the call on privilege
// grounds. For an admin endpoint that is the caller's own role: the guard inside
// the function raised `42501`, which PostgREST answers with 403.
func (e *Error) IsForbidden() bool {
	return e.Status == http.StatusForbidden || e.Code == codeInsufficientPrivilege
}

// IsNotFound reports a call about a row that does not exist.
func (e *Error) IsNotFound() bool {
	return e.Status == http.StatusNotFound || e.Code == codeNoDataFound
}

// IsBadRequest reports a call the function's own validation refused: an illegal
// state transition, a missing reason, an unknown status.
func (e *Error) IsBadRequest() bool {
	if e.Code == codeInvalidParameter {
		return true
	}
	if e.Status == http.StatusBadRequest {
		return true
	}
	return strings.HasPrefix(e.Code, "22")
}

// IsUnauthorized reports a token the database would not accept.
func (e *Error) IsUnauthorized() bool { return e.Status == http.StatusUnauthorized }

// errorEnvelope covers PostgREST's error shape.
type errorEnvelope struct {
	Code string `json:"code"`
}

// errorCode reads only the machine-readable code. PostgREST's `message` and
// `details` can describe the schema or echo the caller's input, so they are
// dropped rather than carried into a log line or a response.
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
	if len(bytes.TrimSpace(raw)) == 0 {
		return errors.New("supabase returned an empty body")
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return errors.New("supabase returned a body that could not be decoded")
	}
	return nil
}

// nullable turns an absent filter into a SQL NULL, which the functions read as
// "not applied". An empty string would be a filter that matches nothing.
func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// ParsePage reads limit and offset from a query string, reporting a failure when
// either is present but not a number in range.
func ParsePage(query url.Values) (Page, error) {
	page := Page{Limit: 50}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return page, fmt.Errorf("limit must be a whole number between 1 and 100")
		}
		page.Limit = value
	}
	if raw := strings.TrimSpace(query.Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 || value > 100000 {
			return page, fmt.Errorf("offset must be a whole number between 0 and 100000")
		}
		page.Offset = value
	}
	return page, nil
}
