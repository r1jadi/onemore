module github.com/r1jadi/onemore/services

go 1.27

require (
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/r1jadi/onemore/packages/go/platform v0.0.0
)

// The platform library is not published to a module proxy; it is consumed from
// this repository. Once it is versioned, drop this directive and pin a real
// version — see docs/decisions/0001-go-module-strategy.md.
replace github.com/r1jadi/onemore/packages/go/platform => ../packages/go/platform
