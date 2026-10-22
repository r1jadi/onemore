package authn

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/r1jadi/unbored/packages/go/platform/adminallowlist"
	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/packages/go/platform/version"
)

// MiddlewareOptions configures the authentication middleware.
type MiddlewareOptions struct {
	// Verifier may be nil for services without auth material yet; required
	// routes then fail closed with 503 instead of allowing anonymous access.
	Verifier *Verifier
	// Required rejects requests without a valid token. When false the request
	// continues as an anonymous identity.
	Required bool
	Logger   *slog.Logger
}

// Middleware authenticates a request and stores the verified identity on the
// context. It returns a plain func so callers can use it as any middleware type.
func Middleware(opts MiddlewareOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := BearerToken(r.Header.Get("Authorization"))

			if token == "" {
				if opts.Required {
					writeAuthError(w, r, apierr.New(apierr.CodeUnauthorized, "Sign in to continue."))
					return
				}
				next.ServeHTTP(w, r.WithContext(identity.WithIdentity(r.Context(), identity.AnonymousIdentity())))
				return
			}

			if opts.Verifier == nil {
				// Misconfiguration must never degrade into "allow everything".
				if opts.Logger != nil {
					opts.Logger.ErrorContext(r.Context(), "auth material missing while a token was presented")
				}
				writeAuthError(w, r, apierr.New(apierr.CodeUnavailable, "Authentication is not available right now."))
				return
			}

			id, err := opts.Verifier.Verify(r.Context(), token)
			if err != nil {
				if opts.Logger != nil {
					// The reason is logged, never returned: it would help an
					// attacker distinguish expired from forged tokens.
					opts.Logger.DebugContext(r.Context(), "token rejected", slog.Any("error", err))
				}
				writeAuthError(w, r, apierr.New(apierr.CodeUnauthorized, "Your session is no longer valid. Sign in again."))
				return
			}

			next.ServeHTTP(w, r.WithContext(identity.WithIdentity(r.Context(), id)))
		})
	}
}

// RequireAdmin authorizes admin API calls. The UI hides admin screens, but this
// check is what actually protects the endpoints.
//
// ADMIN_EMAILS is the single source of truth: a verified token email in the
// server-side allowlist is an administrator, anything else is not. Token role
// claims (`app_metadata.role`) and database rows (`public.user_roles`) never
// grant access. The allowlist is read per request so removal takes effect on
// the next call; missing or empty grants no one.
func RequireAdmin() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := identity.FromContext(r.Context())
			if !ok || id.Anonymous {
				writeAuthError(w, r, apierr.New(apierr.CodeUnauthorized, "Sign in to continue."))
				return
			}
			if !adminallowlist.IsAllowlisted(id.Email) {
				writeAuthError(w, r, apierr.New(apierr.CodeForbidden, "This area requires an administrator account."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireModerator authorizes moderation endpoints. Under the single-source
// model there is no separate moderator grant: the same allowlist decides, so
// an allowlisted administrator reaches moderation endpoints and anyone else
// is refused with the moderator message.
func RequireModerator() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := identity.FromContext(r.Context())
			if !ok || id.Anonymous {
				writeAuthError(w, r, apierr.New(apierr.CodeUnauthorized, "Sign in to continue."))
				return
			}
			if !adminallowlist.IsAllowlisted(id.Email) {
				writeAuthError(w, r, apierr.New(apierr.CodeForbidden, "This area requires a moderator account."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeAuthError writes the shared envelope without importing httpx, which
// imports this package.
func writeAuthError(w http.ResponseWriter, r *http.Request, err error) {
	requestID := ""
	if id := r.Header.Get("X-Request-ID"); id != "" {
		requestID = id
	}
	body := apierr.BodyFor(err, requestID)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("WWW-Authenticate", `Bearer realm="unbored", version="`+version.APIVersion+`"`)
	w.WriteHeader(apierr.Status(body.Code))
	_ = json.NewEncoder(w).Encode(apierr.Envelope{Error: body})
}
