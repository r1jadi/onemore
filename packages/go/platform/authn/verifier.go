package authn

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
)

// Algorithms the platform accepts. `none` and any HMAC algorithm other than the
// legacy HS256 project secret are rejected before parsing.
var (
	asymmetricAlgorithms = []string{"ES256", "RS256"}
	hmacAlgorithm        = "HS256"
)

// Roles carried by Supabase's own project keys. Neither is a signed-in user: the
// service role key bypasses row-level security and the anon key is published in
// every browser bundle. A genuine signature on either is not an identity.
const (
	serviceRoleClaim = "service_role"
	anonRoleClaim    = "anon"
)

// nonUserRoles is refused before an Identity is built, so a leaked project key
// can never be replayed as a user.
var nonUserRoles = map[string]struct{}{serviceRoleClaim: {}, anonRoleClaim: {}}

var userIDPattern = regexp.MustCompile(`^[0-9a-fA-F-]{16,64}$`)

// Verifier validates access tokens and maps them onto an identity.
type Verifier struct {
	jwks       *JWKSProvider
	hmacSecret []byte
	audience   string
	issuer     string
	leeway     time.Duration
	clock      func() time.Time
}

// NewVerifier builds a verifier from configuration. It fails when no
// verification material is configured so a misconfigured deployment cannot
// silently accept unverified requests.
func NewVerifier(cfg *config.Config) (*Verifier, error) {
	supabase := cfg.Supabase
	v := &Verifier{
		audience: supabase.JWTAudience,
		issuer:   supabase.JWTIssuer,
		leeway:   30 * time.Second,
		clock:    time.Now,
	}
	if supabase.JWKSURL != "" {
		v.jwks = NewJWKSProvider(supabase.JWKSURL, &http.Client{Timeout: 5 * time.Second})
	}
	if supabase.JWTSecret != "" {
		if len(supabase.JWTSecret) < 32 {
			return nil, errors.New("SUPABASE_JWT_SECRET looks too short to be a project secret")
		}
		v.hmacSecret = []byte(supabase.JWTSecret)
	}
	if v.jwks == nil && len(v.hmacSecret) == 0 {
		return nil, errors.New("no Supabase token verification material configured")
	}
	return v, nil
}

// NewVerifierWithJWKS builds a verifier around a caller-supplied key provider.
// Tests use it to inject a deterministic key set.
func NewVerifierWithJWKS(provider *JWKSProvider, audience, issuer string) *Verifier {
	return &Verifier{
		jwks:     provider,
		audience: audience,
		issuer:   issuer,
		leeway:   30 * time.Second,
		clock:    time.Now,
	}
}

type accessTokenClaims struct {
	Email     string         `json:"email"`
	Role      string         `json:"role"`
	AppMeta   map[string]any `json:"app_metadata"`
	UserMeta  map[string]any `json:"user_metadata"`
	SessionID string         `json:"session_id"`
	jwt.RegisteredClaims
}

// Verify validates a raw bearer token and returns the caller identity.
func (v *Verifier) Verify(ctx context.Context, rawToken string) (identity.Identity, error) {
	token := strings.TrimSpace(rawToken)
	if token == "" {
		return identity.Identity{}, errors.New("empty token")
	}
	if len(token) > 8192 {
		return identity.Identity{}, errors.New("token too long")
	}

	claims := &accessTokenClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, v.keyFunc(ctx), v.parserOptions()...)
	if err != nil {
		return identity.Identity{}, fmt.Errorf("token rejected: %w", err)
	}
	if !parsed.Valid {
		return identity.Identity{}, errors.New("token is not valid")
	}

	if _, refused := nonUserRoles[strings.ToLower(strings.TrimSpace(claims.Role))]; refused {
		// Server-side tooling and the public project key use these roles. A
		// user-facing request must never be able to present one, even if the
		// signature is genuine.
		return identity.Identity{}, errors.New("project keys are not accepted on user endpoints")
	}
	if claims.Subject == "" || !userIDPattern.MatchString(claims.Subject) {
		return identity.Identity{}, errors.New("token subject is not a valid user id")
	}

	role := identity.RoleUser
	if claims.AppMeta != nil {
		if raw, ok := claims.AppMeta["role"].(string); ok {
			role = identity.NormalizeRole(raw)
		}
	}

	// The expiry is already validated above; carrying it lets a handler report
	// the session's remaining life without parsing the token a second time.
	var expiresAt time.Time
	if claims.ExpiresAt != nil {
		expiresAt = claims.ExpiresAt.Time
	}

	return identity.Identity{
		UserID:    claims.Subject,
		Email:     claims.Email,
		Role:      role,
		ExpiresAt: expiresAt,
	}, nil
}

func (v *Verifier) parserOptions() []jwt.ParserOption {
	options := []jwt.ParserOption{
		jwt.WithValidMethods(v.allowedAlgorithms()),
		jwt.WithLeeway(v.leeway),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(v.clock),
		jwt.WithExpirationRequired(),
	}
	if v.audience != "" {
		options = append(options, jwt.WithAudience(v.audience))
	}
	if v.issuer != "" {
		options = append(options, jwt.WithIssuer(v.issuer))
	}
	return options
}

func (v *Verifier) allowedAlgorithms() []string {
	algorithms := make([]string, 0, 3)
	if v.jwks != nil {
		algorithms = append(algorithms, asymmetricAlgorithms...)
	}
	if len(v.hmacSecret) > 0 {
		algorithms = append(algorithms, hmacAlgorithm)
	}
	return algorithms
}

func (v *Verifier) keyFunc(ctx context.Context) jwt.Keyfunc {
	return func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); ok {
			if len(v.hmacSecret) == 0 {
				return nil, errors.New("symmetric tokens are not enabled for this project")
			}
			return v.hmacSecret, nil
		}

		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("token header is missing a key id")
		}
		if v.jwks == nil {
			return nil, errors.New("this project does not publish signing keys")
		}
		return v.jwks.PublicKey(ctx, kid)
	}
}

// BearerToken extracts the credential from an Authorization header. It never
// reads a token from a query parameter, body or cookie: cookies would reintroduce
// CSRF risk for a JSON API.
func BearerToken(header string) string {
	if header == "" {
		return ""
	}
	scheme, value, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(value)
}
