package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/r1jadi/onemore/packages/go/platform/config"
	"github.com/r1jadi/onemore/packages/go/platform/identity"
)

const (
	testKid      = "test-key-1"
	testAudience = "authenticated"
	testIssuer   = "https://project.supabase.co/auth/v1"
	testUserID   = "8f14e45f-ea8b-4c6c-9f8e-2b3a4c5d6e7f"
)

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// newTestVerifier serves a JWKS for a freshly generated P-256 key and returns a
// verifier plus a signing function.
func newTestVerifier(t *testing.T) (*Verifier, func(claims jwt.MapClaims) string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	jwks := map[string]any{
		"keys": []map[string]any{{
			"kty": "EC",
			"crv": "P-256",
			"kid": testKid,
			"use": "sig",
			"alg": "ES256",
			"x":   b64url(key.PublicKey.X.Bytes()),
			"y":   b64url(key.PublicKey.Y.Bytes()),
		}},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(server.Close)

	verifier := NewVerifierWithJWKS(NewJWKSProvider(server.URL, server.Client()), testAudience, testIssuer)

	sign := func(claims jwt.MapClaims) string {
		token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
		token.Header["kid"] = testKid
		signed, err := token.SignedString(key)
		if err != nil {
			t.Fatalf("sign token: %v", err)
		}
		return signed
	}
	return verifier, sign
}

func validClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub":   testUserID,
		"email": "player@example.com",
		"role":  "authenticated",
		"aud":   testAudience,
		"iss":   testIssuer,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	id, err := verifier.Verify(context.Background(), sign(validClaims()))
	if err != nil {
		t.Fatalf("expected a valid token to verify, got %v", err)
	}
	if id.UserID != testUserID {
		t.Fatalf("user id = %q, want %q", id.UserID, testUserID)
	}
	if id.Role != identity.RoleUser {
		t.Fatalf("role = %q, want %q for a plain authenticated user", id.Role, identity.RoleUser)
	}
	if id.Email != "player@example.com" {
		t.Fatalf("email = %q", id.Email)
	}
}

func TestVerifyReadsRoleFromAppMetadata(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["app_metadata"] = map[string]any{"role": "admin"}

	id, err := verifier.Verify(context.Background(), sign(claims))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !id.IsAdmin() {
		t.Fatalf("role = %q, want admin", id.Role)
	}
	if !id.IsModerator() {
		t.Fatal("admin must also satisfy the moderator check")
	}
}

func TestVerifyUnknownRoleFallsBackToUser(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["app_metadata"] = map[string]any{"role": "superuser"}

	id, err := verifier.Verify(context.Background(), sign(claims))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if id.Role != identity.RoleUser {
		t.Fatalf("unknown roles must not grant privileges, got %q", id.Role)
	}
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["iat"] = time.Now().Add(-2 * time.Hour).Unix()
	claims["exp"] = time.Now().Add(-time.Hour).Unix()

	if _, err := verifier.Verify(context.Background(), sign(claims)); err == nil {
		t.Fatal("expired token was accepted")
	}
}

func TestVerifyRejectsWrongAudience(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["aud"] = "some-other-project"

	if _, err := verifier.Verify(context.Background(), sign(claims)); err == nil {
		t.Fatal("token for another audience was accepted")
	}
}

func TestVerifyRejectsWrongIssuer(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["iss"] = "https://evil.example.com/auth/v1"

	if _, err := verifier.Verify(context.Background(), sign(claims)); err == nil {
		t.Fatal("token from another issuer was accepted")
	}
}

func TestVerifyRejectsServiceRoleToken(t *testing.T) {
	verifier, sign := newTestVerifier(t)

	claims := validClaims()
	claims["role"] = serviceRoleClaim

	if _, err := verifier.Verify(context.Background(), sign(claims)); err == nil {
		t.Fatal("service_role token must never be accepted on user endpoints")
	}
}

func TestVerifyRejectsUnsignedToken(t *testing.T) {
	_, sign := newTestVerifier(t)
	verifier, _ := newTestVerifier(t)

	claims := validClaims()
	unsigned := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	raw, err := unsigned.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("build unsigned token: %v", err)
	}

	if _, err := verifier.Verify(context.Background(), raw); err == nil {
		t.Fatal("alg=none token was accepted")
	}
	_ = sign
}

func TestVerifyRejectsUnknownKeyID(t *testing.T) {
	verifier, _ := newTestVerifier(t)

	// A different key with the correct alg but an unknown kid.
	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, validClaims())
	token.Header["kid"] = "rotated-away"
	raw, err := token.SignedString(otherKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := verifier.Verify(context.Background(), raw); err == nil {
		t.Fatal("token signed by an unpublished key was accepted")
	}
}

func TestVerifyRejectsMalformedInput(t *testing.T) {
	verifier, _ := newTestVerifier(t)

	for name, token := range map[string]string{
		"empty":      "",
		"junk":       "not-a-token",
		"two_parts":  "aaa.bbb",
		"oversized":  strings.Repeat("a", 9000),
		"no_subject": mustSign(t, verifier, jwt.MapClaims{"aud": testAudience, "iss": testIssuer, "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix()}),
	} {
		if _, err := verifier.Verify(context.Background(), token); err == nil {
			t.Fatalf("%s token was accepted", name)
		}
	}
}

func mustSign(t *testing.T, _ *Verifier, _ jwt.MapClaims) string {
	t.Helper()
	// Signing without a subject still needs the test key; reuse the helper.
	_, sign := newTestVerifier(t)
	return sign(jwt.MapClaims{
		"aud": testAudience,
		"iss": testIssuer,
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})
}

func TestNewVerifierRequiresMaterial(t *testing.T) {
	cfg := &config.Config{Service: "test", Environment: config.EnvDevelopment}
	cfg.Supabase.JWTAudience = testAudience

	if _, err := NewVerifier(cfg); err == nil {
		t.Fatal("a verifier without keys or a secret must not be constructible")
	}
}

func TestNewVerifierRejectsShortSecret(t *testing.T) {
	cfg := &config.Config{Service: "test", Environment: config.EnvDevelopment}
	cfg.Supabase.JWTSecret = "too-short"

	if _, err := NewVerifier(cfg); err == nil {
		t.Fatal("a weak HS256 secret must be rejected")
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc.def.ghi":   "abc.def.ghi",
		"bearer abc.def.ghi":   "abc.def.ghi",
		"Basic abc":            "",
		"abc.def.ghi":          "",
		"":                     "",
		"Bearer ":              "",
		"Bearer a b":           "a b",
		"Bearer  spaced-token": "spaced-token",
	}
	for header, want := range cases {
		if got := BearerToken(header); got != want {
			t.Fatalf("BearerToken(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestJWKSParsingRejectsUnsupportedKeys(t *testing.T) {
	if _, err := (jwkKey{Kty: "oct", Kid: "x"}).publicKey(); err == nil {
		t.Fatal("symmetric JWKS entries must be refused")
	}
	if _, err := (jwkKey{Kty: "EC", Crv: "P-384", Kid: "x", X: b64url([]byte{1}), Y: b64url([]byte{2})}).publicKey(); err == nil {
		t.Fatal("unsupported curves must be refused")
	}
	// A point that is not on the curve must fail the curve membership check.
	if _, err := (jwkKey{Kty: "EC", Crv: "P-256", Kid: "x", X: b64url(big.NewInt(1).Bytes()), Y: b64url(big.NewInt(1).Bytes())}).publicKey(); err == nil {
		t.Fatal("off-curve points must be refused")
	}
}
