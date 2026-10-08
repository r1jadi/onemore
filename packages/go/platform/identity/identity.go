// Package identity carries the verified caller identity through a request
// context. Values are only ever produced by verifying a Supabase token — no
// service may build an Identity from a header, body or query parameter.
package identity

import (
	"context"
	"strings"
	"time"
)

// Role values stored in Supabase app_metadata.role.
const (
	RoleUser      = "user"
	RoleModerator = "moderator"
	RoleAdmin     = "admin"
)

// Identity is the authenticated principal for one request.
type Identity struct {
	UserID string
	Email  string
	Role   string
	// ExpiresAt is when the presented token stops being valid. It is zero for an
	// anonymous identity. Handlers report it (the auth service returns it as the
	// session expiry) instead of parsing the token again.
	ExpiresAt time.Time
	// Anonymous is true when no credentials were presented on an optional-auth
	// route. Anonymous callers receive public, read-only data.
	Anonymous bool
}

// NormalizeRole maps a role claim onto one of the three platform roles. Anything
// unrecognised — including Supabase's own `authenticated` role, which means
// "signed in" rather than a platform role — becomes `user`, so an unexpected
// value can never widen access.
func NormalizeRole(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case RoleAdmin:
		return RoleAdmin
	case RoleModerator:
		return RoleModerator
	default:
		return RoleUser
	}
}

// IsAdmin reports whether the identity may use the admin API.
func (i Identity) IsAdmin() bool { return i.Role == RoleAdmin }

// IsModerator reports whether the identity may use moderation endpoints.
func (i Identity) IsModerator() bool { return i.Role == RoleAdmin || i.Role == RoleModerator }

// AnonymousIdentity is the principal used when no token was supplied.
func AnonymousIdentity() Identity { return Identity{Role: RoleUser, Anonymous: true} }

type ctxKey int

const identityKey ctxKey = 1

// WithIdentity stores the identity on a context.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey, id)
}

// FromContext returns the identity and whether one was set.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey).(Identity)
	return id, ok
}

// MustFromContext returns the identity, falling back to anonymous. Use it on
// routes where the middleware guarantees an identity.
func MustFromContext(ctx context.Context) Identity {
	if id, ok := FromContext(ctx); ok {
		return id
	}
	return AnonymousIdentity()
}
