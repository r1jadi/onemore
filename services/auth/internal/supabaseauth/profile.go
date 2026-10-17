package supabaseauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// profileColumns is the only column the service reads from the Data API. The
// profile row is created by the `handle_new_user` trigger, so it exists for
// every user; `onboarded_at` is null until the user finishes onboarding.
const profileColumns = "onboarded_at"

// onboardedRow mirrors the PostgREST projection of `public.profiles`.
type onboardedRow struct {
	OnboardedAt *string `json:"onboarded_at"`
}

// Onboarded reports whether the caller has completed onboarding, read from their
// own profile row.
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
func (c *Client) Onboarded(ctx context.Context, accessToken, userID string) (bool, error) {
	if userID == "" {
		return false, errors.New("an onboarded lookup needs a user id")
	}

	query := url.Values{}
	query.Set("select", profileColumns)
	query.Set("id", "eq."+userID)
	query.Set("limit", "1")

	response, err := c.do(ctx, "profile", http.MethodGet, "/rest/v1/profiles?"+query.Encode(), nil, accessToken)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	var rows []onboardedRow
	if err := decodeJSON(response.Body, &rows); err != nil {
		return false, &Error{Op: "profile", Status: response.StatusCode, cause: err}
	}
	if len(rows) == 0 {
		return false, errors.New("the caller has no profile row")
	}
	return rows[0].OnboardedAt != nil && strings.TrimSpace(*rows[0].OnboardedAt) != "", nil
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
