// Package authn verifies Supabase-issued access tokens. It is the only place
// in the platform that turns a credential into a user identity.
package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// ErrKeyNotFound is returned when the token references a key id the provider
// does not publish.
var ErrKeyNotFound = errors.New("signing key not found")

// JWKSProvider fetches and caches the project's JSON Web Key Set.
//
// Design notes:
//   - Keys are cached for a TTL; an unknown key id triggers at most one refresh
//     per minRefreshInterval so a forged `kid` cannot be used to hammer the
//     Supabase endpoint.
//   - Only asymmetric algorithms supported by the platform are parsed. Symmetric
//     keys must never appear in a JWKS.
type JWKSProvider struct {
	url      string
	client   *http.Client
	ttl      time.Duration
	minFetch time.Duration

	mu        sync.RWMutex
	keys      map[string]any // kid -> *rsa.PublicKey | *ecdsa.PublicKey
	fetchedAt time.Time
	lastTry   time.Time
}

// NewJWKSProvider builds a provider with conservative defaults.
func NewJWKSProvider(url string, client *http.Client) *JWKSProvider {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &JWKSProvider{
		url:      url,
		client:   client,
		ttl:      30 * time.Minute,
		minFetch: 30 * time.Second,
	}
}

// PublicKey returns the key for a key id, refreshing the cache when needed.
func (p *JWKSProvider) PublicKey(ctx context.Context, kid string) (any, error) {
	if key, ok := p.cached(kid); ok {
		return key, nil
	}
	if err := p.refresh(ctx); err != nil {
		// Fall back to a stale key when the refresh failed but the key is known:
		// rotating keys at Supabase should not take the API down.
		if key, ok := p.cached(kid); ok {
			return key, nil
		}
		return nil, err
	}
	if key, ok := p.cached(kid); ok {
		return key, nil
	}
	return nil, ErrKeyNotFound
}

func (p *JWKSProvider) cached(kid string) (any, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	key, ok := p.keys[kid]
	return key, ok
}

func (p *JWKSProvider) refresh(ctx context.Context) error {
	p.mu.Lock()
	if time.Since(p.lastTry) < p.minFetch {
		p.mu.Unlock()
		return fmt.Errorf("jwks refresh throttled")
	}
	p.lastTry = time.Now()
	cached := p.keys
	fetchedAt := p.fetchedAt
	p.mu.Unlock()

	if len(cached) > 0 && time.Since(fetchedAt) < p.ttl {
		return nil
	}

	keys, err := p.fetch(ctx)
	if err != nil {
		return err
	}

	p.mu.Lock()
	p.keys = keys
	p.fetchedAt = time.Now()
	p.mu.Unlock()
	return nil
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	N   string `json:"n"`
	E   string `json:"e"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

func (p *JWKSProvider) fetch(ctx context.Context) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching jwks: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching jwks: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("reading jwks: %w", err)
	}

	var doc jwksDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("decoding jwks: %w", err)
	}

	keys := make(map[string]any, len(doc.Keys))
	for _, key := range doc.Keys {
		if key.Kid == "" || (key.Use != "" && key.Use != "sig") {
			continue
		}
		parsed, err := key.publicKey()
		if err != nil {
			continue
		}
		keys[key.Kid] = parsed
	}
	if len(keys) == 0 {
		return nil, errors.New("jwks contained no usable signing keys")
	}
	return keys, nil
}

func (k jwkKey) publicKey() (any, error) {
	switch k.Kty {
	case "RSA":
		modulus, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, err
		}
		exponent, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, err
		}
		exp := new(big.Int).SetBytes(exponent)
		if !exp.IsInt64() || exp.Int64() <= 0 || exp.Int64() > 1<<31 {
			return nil, errors.New("invalid RSA exponent")
		}
		key := &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: int(exp.Int64())}
		if key.N.BitLen() < 2048 {
			return nil, errors.New("RSA key too small")
		}
		return key, nil
	case "EC":
		if k.Crv != "P-256" {
			return nil, fmt.Errorf("unsupported curve %q", k.Crv)
		}
		x, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			return nil, err
		}
		y, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			return nil, err
		}
		curve := elliptic.P256()
		px, py := new(big.Int).SetBytes(x), new(big.Int).SetBytes(y)
		if !curve.IsOnCurve(px, py) {
			return nil, errors.New("point is not on the P-256 curve")
		}
		return &ecdsa.PublicKey{Curve: curve, X: px, Y: py}, nil
	default:
		return nil, fmt.Errorf("unsupported key type %q", k.Kty)
	}
}
