// Command recommendations owns personalised game suggestions.
//
// The recommendation engine arrives in a later task; the contract is fixed now
// so the client can be written against a stable shape. Recommendations are
// always derived from the verified identity, never from client-supplied taste
// data.
package main

import (
	"github.com/r1jadi/onemore/packages/go/platform/httpx"
	"github.com/r1jadi/onemore/services/internal/servicekit"
)

const serviceName = "recommendations"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.OptionalAuth("GET /api/v1/recommendations",
				httpx.NotImplemented(serviceName, "Reading recommendations"))

			router.AuthenticatedFunc("POST /api/v1/recommendations/feedback",
				httpx.NotImplemented(serviceName, "Recording recommendation feedback"))
		},
	})
}
