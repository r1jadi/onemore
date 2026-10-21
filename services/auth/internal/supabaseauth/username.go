package supabaseauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// UsernameAvailable reports whether a username is still unclaimed.
//
// The read goes to the Data API with the publishable key and no bearer token:
// `anon` has a column-level SELECT grant on `profiles` and the
// `profiles_select_public` policy allows the row, so availability can be
// answered before any account exists. Only `id` is selected and nothing but the
// boolean leaves this package — the caller's endpoint never exposes another
// person's profile.
//
// `username` is already normalized (trimmed and lowercased) by the auth service.
// The column is `citext`, so the equality filter is case-insensitive even if a
// caller reaches this with another spelling.
func (c *Client) UsernameAvailable(ctx context.Context, username string) (bool, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return false, errors.New("an availability lookup needs a username")
	}

	query := url.Values{}
	query.Set("select", "id")
	query.Set("username", "eq."+username)
	query.Set("limit", "1")

	response, err := c.do(ctx, "username-available", http.MethodGet, "/rest/v1/profiles?"+query.Encode(), nil, "")
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	// A row means the name is taken. Only the id is decoded, and it is discarded
	// rather than returned: the answer is a boolean, not a directory entry.
	var rows []struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(response.Body, &rows); err != nil {
		return false, &Error{Op: "username-available", Status: response.StatusCode, cause: err}
	}
	return len(rows) == 0, nil
}
