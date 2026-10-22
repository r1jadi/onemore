// Package version exposes build metadata. Values are injected at build time:
//
//	go build -ldflags "-X github.com/r1jadi/unbored/packages/go/platform/version.Version=$(git rev-parse --short HEAD)"
package version

// APIVersion is the version segment of the public API path (/api/v1).
const APIVersion = "v1"

// Values below are overridden by the linker in release builds.
var (
	// Version is the git revision of the build.
	Version = "dev"
	// Commit is the full commit hash when available.
	Commit = ""
	// BuiltAt is the build timestamp (RFC 3339).
	BuiltAt = ""
)
