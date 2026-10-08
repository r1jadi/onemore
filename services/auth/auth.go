// Package auth defines the Auth service and its entrypoints.
//
// Supabase Auth is the identity provider: it stores credentials, enforces the
// password policy, sends confirmation and recovery email and issues access and
// refresh tokens. This service never sees a password beyond passing it to
// Supabase, and never stores one. What it owns is the application's *session*:
//
//   - it exposes the credential lifecycle the web app needs (sign up, sign in,
//     refresh, sign out) so a browser talks to one origin and no Supabase key —
//     publishable or secret — has to be shipped to the client;
//   - it answers "who is this, and what may they see" for a token, using the same
//     JWKS verifier every other service uses (packages/go/platform/authn), so
//     there is exactly one authentication implementation in the platform;
//   - it reports the caller's onboarding state from their own profile row, read
//     through the Data API with the caller's token, which keeps Row Level
//     Security as the boundary rather than granting this service the secret key.
//
// Every handler verifies before it trusts: the authenticated routes have already
// been checked by authn.Middleware, POST /auth/session verifies the token it is
// handed, and the identity is never taken from a header, body or query value.
package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/r1jadi/onemore/packages/go/platform/apierr"
	"github.com/r1jadi/onemore/packages/go/platform/authn"
	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/packages/go/platform/identity"
	"github.com/r1jadi/onemore/services/auth/internal/supabaseauth"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

// Name is the service name used in logs, configuration validation and the
// SERVICE_NAME default.
const Name = "auth"

// Routes. They are constants so the contract, the tests and the README cannot
// drift from what the router registers.
const (
	SignUpPath  = "/api/v1/auth/sign-up"
	SignInPath  = "/api/v1/auth/sign-in"
	RefreshPath = "/api/v1/auth/refresh"
	SessionPath = "/api/v1/auth/session"
	SignOutPath = "/api/v1/auth/sign-out"
)

const (
	// maxCredentialsBytes bounds a credential body. Long before this the server's
	// own body limit applies; this is the tighter, endpoint-level bound.
	maxCredentialsBytes = 8 << 10
	// maxTokenBytes matches the verifier's own ceiling, so a token the service
	// would refuse to verify is refused before it is handled.
	maxTokenBytes = 8192
	// maxPasswordBytes is bcrypt's input limit. Supabase hashes with bcrypt, which
	// silently ignores everything past 72 bytes, so a longer password would be far
	// weaker than it looks. Refusing it is kinder than truncating it.
	maxPasswordBytes = 72
	// minPasswordBytes matches the password rule the signup screen states.
	minPasswordBytes = 8
	// maxEmailBytes is the maximum length of an email address.
	maxEmailBytes = 254
)

// Backend is the Supabase surface the service needs.
//
// It is an interface for two reasons: the handlers are tested without a network,
// and a deployment that has not been given Supabase credentials can still boot,
// serve probes and answer 503 on this handful of endpoints instead of crashing
// in a restart loop.
type Backend interface {
	SignUp(ctx context.Context, email, password string) (supabaseauth.Result, error)
	SignInWithPassword(ctx context.Context, email, password string) (supabaseauth.Result, error)
	RefreshSession(ctx context.Context, refreshToken string) (supabaseauth.Result, error)
	SignOut(ctx context.Context, accessToken string) error
	// Onboarded reads the caller's own profile row with the caller's token.
	Onboarded(ctx context.Context, accessToken, userID string) (bool, error)
}

// sessionView is the application's view of a session. It carries no token: it is
// what the web app needs to render.
//
// `onboarded` and `expiresAt` are omitted when they are genuinely unknown — a
// failed profile read must not be reported as "not onboarded", which would send
// an onboarded user through onboarding a second time.
type sessionView struct {
	UserID    string     `json:"userId"`
	Role      string     `json:"role"`
	Email     string     `json:"email,omitempty"`
	Onboarded *bool      `json:"onboarded,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

// tokensView is the Supabase token pair. It is returned to the client and to
// nowhere else: it is never logged, and the response is no-store.
type tokensView struct {
	AccessToken  string     `json:"accessToken"`
	RefreshToken string     `json:"refreshToken"`
	TokenType    string     `json:"tokenType"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	ExpiresIn    int        `json:"expiresIn,omitempty"`
}

// userView is the Supabase user record, trimmed to what the app shows. Supabase
// fields that describe infrastructure (identities, factors, aud, role) are
// deliberately not echoed.
type userView struct {
	ID             string    `json:"id"`
	Email          string    `json:"email"`
	EmailConfirmed bool      `json:"emailConfirmed"`
	CreatedAt      time.Time `json:"createdAt"`
}

// authSession is the payload of sign-up, sign-in and refresh: the session view,
// the tokens to store, and the user record. Tokens are absent while Supabase
// requires email confirmation, because no session exists until then.
type authSession struct {
	Session sessionView `json:"session"`
	Tokens  *tokensView `json:"tokens,omitempty"`
	User    *userView   `json:"user,omitempty"`
}

// credentialsRequest is the body of sign-up and sign-in.
type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// refreshRequest is the body of the refresh endpoint. A refresh token is a
// credential, so it travels in the body of a POST and never in a query string,
// where it would end up in access logs and browser history.
type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

// exchangeRequest is the body of POST /auth/session.
type exchangeRequest struct {
	AccessToken string `json:"accessToken"`
}

// credentialMode selects which password rules apply to a body.
type credentialMode int

const (
	modeSignUp credentialMode = iota
	modeSignIn
)

// limitKey names one bucket a credential request is metered in. The key value is
// never logged — an account key is derived from an email address.
type limitKey struct {
	scope string
	key   string
}

// service holds the handlers' dependencies. `backend` and `verifier` may each be
// nil when the deployment has not been given Supabase material yet.
type service struct {
	backend     Backend
	verifier    *authn.Verifier
	logger      *slog.Logger
	credentials *httpx.RateLimiter
}

func newService(backend Backend, verifier *authn.Verifier, logger *slog.Logger, credentials *httpx.RateLimiter) *service {
	if logger == nil {
		logger = slog.Default()
	}
	return &service{backend: backend, verifier: verifier, logger: logger, credentials: credentials}
}

// register mounts the routes. The credential endpoints are public because they
// are how a caller without a session obtains one; the session view and sign-out
// require a verified token, which the shared middleware checks before the
// handler runs.
func (s *service) register(router *httpx.Router) {
	router.PublicFunc("POST "+SignUpPath, s.signUp)
	router.PublicFunc("POST "+SignInPath, s.signIn)
	router.PublicFunc("POST "+RefreshPath, s.refresh)
	// Public by design: the caller presents a Supabase token in the body rather
	// than a header. That is how a client which just completed a Supabase-side
	// flow (an emailed link, an OAuth redirect) asks for the application session
	// it does not hold yet. The token is verified before it is trusted.
	router.PublicFunc("POST "+SessionPath, s.exchangeSession)

	router.AuthenticatedFunc("GET "+SessionPath, s.currentSession)
	router.AuthenticatedFunc("POST "+SignOutPath, s.signOut)
}

// ── Handlers ────────────────────────────────────────────────────────────────

func (s *service) signUp(w http.ResponseWriter, r *http.Request) {
	request, email, ok := s.credentialsBody(w, r, modeSignUp)
	if !ok {
		return
	}
	if s.throttled(w, r, limitKey{"ip", httpx.ClientKey(r)}, limitKey{"account", supabaseauth.EscapeEmail(email)}) {
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "sign-up")
		return
	}

	result, err := s.backend.SignUp(r.Context(), email, request.Password)
	if err != nil {
		s.supabaseFailure(w, r, "sign-up", err)
		return
	}
	// 201: a user was created. When the project requires email confirmation the
	// payload carries the user and no tokens, which is a success, not a failure.
	httpx.WriteJSON(w, r, http.StatusCreated, s.newAuthSession(r.Context(), result))
}

func (s *service) signIn(w http.ResponseWriter, r *http.Request) {
	request, email, ok := s.credentialsBody(w, r, modeSignIn)
	if !ok {
		return
	}
	if s.throttled(w, r, limitKey{"ip", httpx.ClientKey(r)}, limitKey{"account", supabaseauth.EscapeEmail(email)}) {
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "sign-in")
		return
	}

	result, err := s.backend.SignInWithPassword(r.Context(), email, request.Password)
	if err != nil {
		s.supabaseFailure(w, r, "sign-in", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, s.newAuthSession(r.Context(), result))
}

func (s *service) refresh(w http.ResponseWriter, r *http.Request) {
	var request refreshRequest
	if !s.decode(w, r, &request) {
		return
	}
	token := strings.TrimSpace(request.RefreshToken)
	if token == "" || len(token) > maxTokenBytes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Provide the refresh token to use.",
			apierr.Detail{Field: "refreshToken", Rule: "required"}))
		return
	}
	// Keyed by client only: an account bucket would mean keeping a credential in
	// memory as a map key, and a refresh token is not something to retain.
	if s.throttled(w, r, limitKey{"ip", httpx.ClientKey(r)}) {
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "refresh")
		return
	}

	result, err := s.backend.RefreshSession(r.Context(), token)
	if err != nil {
		s.supabaseFailure(w, r, "refresh", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, s.newAuthSession(r.Context(), result))
}

// exchangeSession turns a Supabase access token into the application session
// view. It verifies the token through the platform verifier rather than trusting
// it, so an expired, forged or service-role token is refused here exactly as it
// would be on any other endpoint.
func (s *service) exchangeSession(w http.ResponseWriter, r *http.Request) {
	var request exchangeRequest
	if !s.decode(w, r, &request) {
		return
	}
	token := strings.TrimSpace(request.AccessToken)
	if token == "" || len(token) > maxTokenBytes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Provide the access token to exchange.",
			apierr.Detail{Field: "accessToken", Rule: "required"}))
		return
	}
	if s.verifier == nil {
		s.notConfigured(w, r, "session exchange")
		return
	}

	id, err := s.verifier.Verify(r.Context(), token)
	if err != nil {
		// The reason is logged, never returned: it would let a caller tell an
		// expired token from a forged one.
		s.logger.DebugContext(r.Context(), "session exchange rejected a token", slog.Any("error", err))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Your session is no longer valid. Sign in again."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, s.viewFor(r.Context(), id, token))
}

// currentSession reports the caller's session from the identity the middleware
// verified. It cannot fail on authentication: a tokenless or invalid request was
// already rejected with 401 before this ran.
func (s *service) currentSession(w http.ResponseWriter, r *http.Request) {
	id := identity.MustFromContext(r.Context())
	if id.Anonymous || id.UserID == "" {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to continue."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, s.viewFor(r.Context(), id, authn.BearerToken(r.Header.Get("Authorization"))))
}

func (s *service) signOut(w http.ResponseWriter, r *http.Request) {
	token := authn.BearerToken(r.Header.Get("Authorization"))
	if token == "" {
		// Unreachable while the route is registered as authenticated; kept so the
		// handler is safe if that ever changes.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to continue."))
		return
	}
	if s.backend == nil {
		// Revoking the session is the whole point of signing out, so this one
		// cannot be answered locally: reporting success would be a lie.
		s.notConfigured(w, r, "sign-out")
		return
	}

	if err := s.backend.SignOut(r.Context(), token); err != nil {
		s.supabaseFailure(w, r, "sign-out", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusNoContent, nil)
}

// ── Response building ───────────────────────────────────────────────────────

// viewFor builds the session view from a verified identity, adding the caller's
// onboarding state when their own profile row can be read.
func (s *service) viewFor(ctx context.Context, id identity.Identity, token string) sessionView {
	return sessionView{
		UserID:    id.UserID,
		Role:      id.Role,
		Email:     id.Email,
		Onboarded: s.onboarded(ctx, token, id.UserID),
		ExpiresAt: timePointer(id.ExpiresAt),
	}
}

// newAuthSession builds the sign-up, sign-in and refresh payload from a Supabase
// response. The role comes from the `app_metadata.role` Supabase issued in the
// token, so the session view and the token the client will send agree by
// construction; an unknown value normalises to `user`.
func (s *service) newAuthSession(ctx context.Context, result supabaseauth.Result) authSession {
	payload := authSession{Session: sessionView{Role: identity.RoleUser}}

	if result.User != nil {
		payload.User = &userView{
			ID:             result.User.ID,
			Email:          result.User.Email,
			EmailConfirmed: result.User.EmailConfirmedAt != nil,
			CreatedAt:      result.User.CreatedAt,
		}
		payload.Session.UserID = result.User.ID
		payload.Session.Email = result.User.Email
		payload.Session.Role = roleFromUser(result.User)
	}

	if result.Session != nil {
		payload.Session.ExpiresAt = timePointer(result.Session.ExpiresAt)
		payload.Tokens = &tokensView{
			AccessToken:  result.Session.AccessToken,
			RefreshToken: result.Session.RefreshToken,
			TokenType:    result.Session.TokenType,
			ExpiresAt:    payload.Session.ExpiresAt,
			ExpiresIn:    result.Session.ExpiresIn,
		}
		// Only readable with a token. With none — email confirmation pending — the
		// answer is left out rather than guessed.
		payload.Session.Onboarded = s.onboarded(ctx, result.Session.AccessToken, payload.Session.UserID)
	}

	return payload
}

// onboarded reads the caller's onboarding state with their own token. A failure
// yields no answer instead of a false one: the session is still valid, only this
// single field is unknown, and "not onboarded" would be acted on.
func (s *service) onboarded(ctx context.Context, token, userID string) *bool {
	if s.backend == nil || token == "" || userID == "" {
		return nil
	}
	value, err := s.backend.Onboarded(ctx, token, userID)
	if err != nil {
		s.logger.WarnContext(ctx, "could not read onboarding state", slog.Any("error", err))
		return nil
	}
	return &value
}

// roleFromUser reads the platform role from the app metadata Supabase issued.
func roleFromUser(user *supabaseauth.User) string {
	if user == nil || user.AppMetadata == nil {
		return identity.RoleUser
	}
	raw, _ := user.AppMetadata["role"].(string)
	return identity.NormalizeRole(raw)
}

func timePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	utc := value.UTC()
	return &utc
}

// ── Request handling ────────────────────────────────────────────────────────

// credentialsBody decodes and validates a credential body, writing the response
// itself when it cannot. The returned email is trimmed; the password is never
// copied anywhere it could be logged.
func (s *service) credentialsBody(w http.ResponseWriter, r *http.Request, mode credentialMode) (credentialsRequest, string, bool) {
	var request credentialsRequest
	if !s.decode(w, r, &request) {
		return request, "", false
	}

	email := strings.TrimSpace(request.Email)
	if email == "" || len(email) > maxEmailBytes || !validEmail(email) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Enter a valid email address.",
			apierr.Detail{Field: "email", Rule: "format"}))
		return request, "", false
	}

	password := request.Password
	switch {
	case password == "":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Enter your password.",
			apierr.Detail{Field: "password", Rule: "required"}))
		return request, "", false
	case mode == modeSignUp && len(password) < minPasswordBytes:
		// Supabase owns the real policy and answers `weak_password`; this is the
		// one rule the signup screen states, so it is enforced before the round
		// trip to give the caller a precise answer.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Use at least 8 characters for your password.",
			apierr.Detail{Field: "password", Rule: "minLength"}))
		return request, "", false
	case mode == modeSignUp && len(password) > maxPasswordBytes:
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Use at most 72 characters for your password.",
			apierr.Detail{Field: "password", Rule: "maxLength"}))
		return request, "", false
	}

	return request, email, true
}

// decode reads a strict JSON body. Unknown fields, a wrong content type and an
// oversized body are all rejected by the shared helper.
func (s *service) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := httpx.DecodeJSON(w, r, maxCredentialsBytes, dst); err != nil {
		httpx.WriteError(w, r, err)
		return false
	}
	return true
}

// validEmail accepts only a bare address. The standard parser also accepts a
// display name ("Ada <ada@example.com>"), which is not a credential.
func validEmail(email string) bool {
	address, err := mail.ParseAddress(email)
	return err == nil && address.Address == email
}

// throttled enforces the credential buckets. It runs before any Supabase call so
// the endpoint cannot be used to amplify traffic, and it reports which bucket was
// spent without ever logging the key.
func (s *service) throttled(w http.ResponseWriter, r *http.Request, keys ...limitKey) bool {
	if s.credentials == nil {
		return false
	}
	for _, key := range keys {
		if s.credentials.Allow(key.key) {
			continue
		}
		s.logger.WarnContext(r.Context(), "credential request throttled", slog.String("scope", key.scope))
		w.Header().Set("Retry-After", "30")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeRateLimited, "Too many attempts. Wait a moment and try again."))
		return true
	}
	return false
}

// notConfigured answers an endpoint whose Supabase dependency is missing.
func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "auth dependency is not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Authentication is not available right now."))
}

// supabaseFailure maps a Supabase failure onto the platform's envelope. Only a
// message written here is ever sent: Supabase's own text can describe the
// project's auth configuration, and its machine-readable code is enough to
// classify the failure. The error carries an operation, an HTTP status and that
// code — never the response body, the password or a token — so it is safe to log.
func (s *service) supabaseFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var apiErr *supabaseauth.Error
	if errors.As(err, &apiErr) {
		switch {
		case apiErr.Code == supabaseauth.CodeInvalidCredentials ||
			(apiErr.Code == supabaseauth.CodeInvalidGrant && operation == "sign-in"):
			// Older GoTrue deployments answer a wrong password with
			// `invalid_grant`, the code the modern API reserves for a stale
			// refresh token, so the operation decides the meaning.
			s.logger.InfoContext(r.Context(), "credential attempt rejected", slog.String("operation", operation))
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "That email and password do not match."))
			return
		case apiErr.Code == supabaseauth.CodeEmailNotConfirmed:
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeForbidden, "Confirm your email address, then sign in."))
			return
		case apiErr.Code == supabaseauth.CodeEmailExists || apiErr.Code == supabaseauth.CodeUserAlreadyExists:
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "An account with that email already exists."))
			return
		case apiErr.Code == supabaseauth.CodeWeakPassword:
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, "Choose a stronger password."))
			return
		case apiErr.Code == supabaseauth.CodeValidationFailed:
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, "Check the details you entered and try again."))
			return
		case apiErr.Code == supabaseauth.CodeOverRequestRate || apiErr.Code == supabaseauth.CodeOverEmailRate:
			w.Header().Set("Retry-After", "60")
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeRateLimited, "Too many attempts. Wait a moment and try again."))
			return
		case apiErr.Code == supabaseauth.CodeInvalidGrant || apiErr.Code == supabaseauth.CodeRefreshTokenMissing:
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Your session has expired. Sign in again."))
			return
		}
	}

	s.logger.ErrorContext(r.Context(), "supabase call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Authentication is not available right now."))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// credentialRateLimit is the budget for the credential endpoints. It is far
// tighter than the API-wide bucket because every attempt can verify a password,
// and it is a bucket of its own so a burst of sign-in attempts cannot spend the
// budget every other endpoint shares.
func credentialRateLimit() config.RateLimit {
	return config.RateLimit{
		Enabled:           true,
		RequestsPerMinute: config.EnvInt("AUTH_RATE_LIMIT_REQUESTS_PER_MINUTE", 10),
		Burst:             config.EnvInt("AUTH_RATE_LIMIT_BURST", 5),
	}
}

// Options returns the wiring every auth entrypoint runs.
func Options() servicekit.Options {
	credentials := httpx.NewRateLimiter(credentialRateLimit())

	return servicekit.Options{
		Name:          Name,
		ExtraLimiters: []*httpx.RateLimiter{credentials},

		// RegisterWith runs after the standard wiring, so these handlers receive
		// the same verifier the middleware uses: one authentication
		// implementation, not two that can disagree.
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, verifier *authn.Verifier) {
			var backend Backend
			client, err := supabaseauth.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the credential endpoints, which is
				// far more diagnosable than a crash loop. The error names the
				// missing variables and carries no value.
				logger.Warn("Supabase Auth is not configured; its credential endpoints answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, verifier, logger, credentials).register(router)
		},
	}
}
