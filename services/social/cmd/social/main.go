// Command social owns comments, follows and likes.
//
// Every write is attributed to the token's user id. Ownership checks happen in
// the service and again in Row Level Security, so a bug in one layer does not
// grant write access to another player's row.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "social"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.PublicFunc("GET /api/v1/comments",
				httpx.NotImplemented(serviceName, "Listing comments"))

			router.AuthenticatedFunc("POST /api/v1/comments",
				httpx.NotImplemented(serviceName, "Posting a comment"))

			router.AuthenticatedFunc("DELETE /api/v1/comments/{commentID}",
				httpx.NotImplemented(serviceName, "Deleting an owned comment"))

			router.AuthenticatedFunc("POST /api/v1/follows",
				httpx.NotImplemented(serviceName, "Following a user"))

			router.AuthenticatedFunc("DELETE /api/v1/follows/{username}",
				httpx.NotImplemented(serviceName, "Unfollowing a user"))

			router.AuthenticatedFunc("POST /api/v1/likes",
				httpx.NotImplemented(serviceName, "Liking a game or comment"))

			router.AuthenticatedFunc("DELETE /api/v1/likes/{targetID}",
				httpx.NotImplemented(serviceName, "Removing a like"))
		},
	})
}
