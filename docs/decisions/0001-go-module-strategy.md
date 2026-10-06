# 0001 — Go module strategy: one platform library, one services module

* Status: accepted
* Date: 2026-10-05

## Context

Fifteen services are planned. They share request-id handling, configuration,
logging, error envelopes, security headers, CORS, rate limiting, health probes and
JWT verification. Creating fifteen modules up front would mean fifteen `go.mod`
files, fifteen dependency sets to keep in step, and a version-pinning problem
between a service module and the shared library it depends on — before a single
feature exists.

The services also must be independently deployable, and the arrangement must not
have to be unpicked later.

## Decision

Two modules, wired together by a `go.work` at the repository root:

* `packages/go/platform` — the shared library (config, logging, apierr, identity,
  httpx, authn, version).
* `services` — one module containing every service as `services/<name>/cmd/<name>`.
  It resolves the platform library through a `replace` directive, so
  `cd services && go build ./...` works with or without the workspace.

Each service builds to its own binary, which is what "deployable independently"
actually requires. A service graduates to its own module when it needs an
independent release cadence or a dependency the others should not inherit; that is
a `go.mod` plus a `go work use`, and no code moves.

The platform library holds something only when at least two services need it.
Shared code that would exist "just in case" is not added.

## Consequences

* Adding a service costs one directory and one `main.go`; testing the platform
  change once covers every service.
* A service cannot accidentally depend on another service's internals: nothing
  outside `cmd/` is importable from another service, because the module's
  `internal/` packages are not importable outside it.
* One version of the platform library at a time. If two services ever need
  different versions of it, that is the trigger to split a module, not to add
  compatibility shims.
* The `replace` directive must be removed and replaced with a real version pin if
  the library is ever published to a module proxy.
* CI must build every service binary explicitly (it does, in `go.yml`), because a
  single `go build ./...` would not prove each binary links.
