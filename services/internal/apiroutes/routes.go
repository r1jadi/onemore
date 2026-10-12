// Package apiroutes is the single source of truth for which service owns which
// `/api/v1` path prefix. The gateway routes by this table, tests assert it and
// docs/architecture/api.md documents it.
//
// Adding a group here does not expose it: the gateway only forwards a group
// when its UPSTREAM_<SERVICE>_URL is configured.
package apiroutes

// Group maps a public API prefix to the service that owns it.
type Group struct {
	Prefix  string
	Service string
}

// Version is the only API version served today.
const Version = "v1"

// BasePath is the versioned API root.
const BasePath = "/api/" + Version

// Groups lists every service-owned API prefix, longest-lived first.
func Groups() []Group {
	return []Group{
		{Prefix: BasePath + "/auth", Service: "auth"},
		{Prefix: BasePath + "/users", Service: "users"},
		{Prefix: BasePath + "/games", Service: "games"},
		// Categories are the catalogue's own reference data, served by the games
		// service so a category page and its game list come from one place (and
		// one database query for the counts).
		{Prefix: BasePath + "/categories", Service: "games"},
		{Prefix: BasePath + "/sessions", Service: "game-sessions"},
		{Prefix: BasePath + "/scores", Service: "scores"},
		{Prefix: BasePath + "/leaderboards", Service: "leaderboards"},
		{Prefix: BasePath + "/feed", Service: "feed"},
		{Prefix: BasePath + "/recommendations", Service: "recommendations"},
		{Prefix: BasePath + "/comments", Service: "social"},
		{Prefix: BasePath + "/follows", Service: "social"},
		{Prefix: BasePath + "/likes", Service: "social"},
		{Prefix: BasePath + "/notifications", Service: "notifications"},
		{Prefix: BasePath + "/search", Service: "search"},
		{Prefix: BasePath + "/moderation", Service: "moderation"},
		{Prefix: BasePath + "/analytics", Service: "analytics"},
		{Prefix: BasePath + "/admin", Service: "admin"},
	}
}

// Services lists every backend service in the platform. The Go workspace, CI
// matrix and docs derive from this list.
func Services() []string {
	return []string{
		"gateway", "auth", "users", "games", "game-sessions", "scores",
		"leaderboards", "feed", "recommendations", "social", "notifications",
		"search", "moderation", "analytics", "admin",
	}
}
