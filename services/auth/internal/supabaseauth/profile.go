package supabaseauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// profileColumns is the only column the service reads from the Data API. The
// profile row is created by the `handle_new_user` trigger, so it exists for
// every user; `onboarded_at` is null until the user finishes onboarding.
const profileColumns = "onboarded_at"

// onboardedRow mirrors the PostgREST projection of `public.profiles`.
type onboardedRow struct {
	OnboardedAt *string `json:"onboarded_at"`
}

// Onboarding is the caller's registration state read from their own profile.
//
// CompletedAt is nil when the marker is unset. A missing profile row is an
// error, not an unset marker: the trigger creates the row at signup, so its
// absence is a data gap the service must not turn into "not onboarded".
type Onboarding struct {
	CompletedAt *time.Time
}

// Onboarding reads the caller's own registration marker.
//
// The read runs as the caller: the publishable key is the `apikey` header and the
// caller's access token is the bearer credential, so Row Level Security decides
// what is visible and the service never needs the secret key. `userID` comes from
// a verified token subject, which the verifier has already restricted to
// hex-and-dash characters, so it cannot alter the query.
//
// A user with no profile row is *unknown*, not "not onboarded": the row is
// created by the `handle_new_user` trigger at signup, so an account that
// predates a fixed trigger — or whose profile insert failed — has none even
// though it may be as old as the project. Reporting false would route that
// account back through sign-up, where the completion write has no row to land
// on, so the absence is reported as an error and the service leaves the field
// unset instead of acting on a guess.
func (c *Client) Onboarding(ctx context.Context, accessToken, userID string) (Onboarding, error) {
	if userID == "" {
		return Onboarding{}, errors.New("an onboarding lookup needs a user id")
	}

	query := url.Values{}
	query.Set("select", profileColumns)
	query.Set("id", "eq."+userID)
	query.Set("limit", "1")

	response, err := c.do(ctx, "profile", http.MethodGet, "/rest/v1/profiles?"+query.Encode(), nil, accessToken)
	if err != nil {
		return Onboarding{}, err
	}
	defer response.Body.Close()

	var rows []onboardedRow
	if err := decodeJSON(response.Body, &rows); err != nil {
		return Onboarding{}, &Error{Op: "profile", Status: response.StatusCode, cause: err}
	}
	if len(rows) == 0 {
		return Onboarding{}, errors.New("the caller has no profile row")
	}
	raw := ""
	if rows[0].OnboardedAt != nil {
		raw = strings.TrimSpace(*rows[0].OnboardedAt)
	}
	if raw == "" {
		return Onboarding{}, nil
	}
	completedAt, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return Onboarding{}, &Error{Op: "profile", Status: response.StatusCode, cause: err}
	}
	return Onboarding{CompletedAt: &completedAt}, nil
}

// User returns the caller's Supabase Auth record.
//
// It is the authoritative source for `created_at`, which the service uses to
// tell an account made by the old sign-up flow (no completion marker, and no
// completion step to produce one) from a new account that still has onboarding
// to finish. The call runs with the caller's own access token, so Supabase
// decides whose record this is; the client never accepts a user id from a
// request body or query.
func (c *Client) User(ctx context.Context, accessToken string) (User, error) {
	if accessToken == "" {
		return User{}, errors.New("a user lookup needs the caller's token")
	}
	response, err := c.do(ctx, "user", http.MethodGet, "/auth/v1/user", nil, accessToken)
	if err != nil {
		return User{}, err
	}
	defer response.Body.Close()

	var user User
	if err := decodeJSON(response.Body, &user); err != nil {
		return User{}, &Error{Op: "user", Status: response.StatusCode, cause: err}
	}
	return user, nil
}

// MarkOnboarded records the caller as registered, but only while their marker is
// still unset. It repairs an account created before the completion flow shipped,
// so every later session does not have to re-derive its age.
//
// The write runs as the caller with the publishable key and their own access
// token: the `profiles_update_self` policy and the column grant are the boundary,
// so this can only update the caller's own row and never another account.
func (c *Client) MarkOnboarded(ctx context.Context, accessToken, userID string, at time.Time) error {
	if userID == "" {
		return errors.New("an onboarding write needs a user id")
	}
	if accessToken == "" {
		return errors.New("an onboarding write needs the caller's token")
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}

	query := url.Values{}
	query.Set("id", "eq."+userID)
	query.Set("onboarded_at", "is.null")
	response, err := c.do(ctx, "onboarded", http.MethodPatch, "/rest/v1/profiles?"+query.Encode(), map[string]string{
		"onboarded_at": at.UTC().Format(time.RFC3339Nano),
	}, accessToken)
	if err != nil {
		return err
	}
	response.Body.Close()
	return nil
}

// EscapeEmail normalises an address for the per-account rate limiter key.
//
// Supabase trims and lowercases addresses on its side, and the limiter would
// otherwise be keyed by exactly what the caller typed, so `A@b.com` and
// `a@b.com ` would each get their own budget and an attacker could spend both.
// The value only ever keys a bucket: it never reaches Supabase or a log line.
func EscapeEmail(email string) string {
	return url.QueryEscape(strings.ToLower(strings.TrimSpace(email)))
}
