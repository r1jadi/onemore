package adminallowlist

import (
	"testing"
)

func TestParseMultipleEmails(t *testing.T) {
	got := Parse("admin@example.com,another@example.com")
	if len(got) != 2 || got[0] != "admin@example.com" || got[1] != "another@example.com" {
		t.Fatalf("Parse = %v, want the two addresses", got)
	}
}

func TestParseTrimsWhitespaceAndLowercases(t *testing.T) {
	got := Parse("  Admin@Example.COM ,  ANOTHER@example.com\t")
	if len(got) != 2 || got[0] != "admin@example.com" || got[1] != "another@example.com" {
		t.Fatalf("Parse = %v, want trimmed lower-cased addresses", got)
	}
}

func TestParseDropsEmptiesDuplicatesAndNonEmails(t *testing.T) {
	got := Parse("admin@example.com,, ,admin@example.com,ADMIN@example.com,not-an-email,")
	if len(got) != 1 || got[0] != "admin@example.com" {
		t.Fatalf("Parse = %v, want one deduplicated address", got)
	}
}

func TestParseMissingOrEmptyGrantsNoOne(t *testing.T) {
	for _, raw := range []string{"", "   ", " , , ", "not-an-email"} {
		if got := Parse(raw); len(got) != 0 {
			t.Errorf("Parse(%q) = %v, want empty (fail-closed)", raw, got)
		}
	}
}

func TestIsAllowlistedWithIsCaseInsensitive(t *testing.T) {
	allowlist := []string{"admin@example.com"}
	for _, email := range []string{"admin@example.com", "ADMIN@EXAMPLE.COM", "  Admin@Example.com  "} {
		if !IsAllowlistedWith(email, allowlist) {
			t.Errorf("IsAllowlistedWith(%q) = false, want true", email)
		}
	}
}

func TestIsAllowlistedWithRejects(t *testing.T) {
	allowlist := []string{"admin@example.com"}
	for _, email := range []string{"", "   ", "other@example.com", "admin@example.com.evil.com", "admin@other.com"} {
		if IsAllowlistedWith(email, allowlist) {
			t.Errorf("IsAllowlistedWith(%q) = true, want false", email)
		}
	}
	if IsAllowlistedWith("admin@example.com", nil) {
		t.Error("empty allowlist must grant no one")
	}
	if IsAllowlistedWith("admin@example.com", []string{}) {
		t.Error("empty allowlist must grant no one")
	}
}

func TestIsAllowlistedReadsCurrentEnv(t *testing.T) {
	t.Setenv(EnvVar, "admin@example.com")
	if !IsAllowlisted("ADMIN@example.com") {
		t.Fatal("allowlisted email was refused")
	}
	if IsAllowlisted("other@example.com") {
		t.Fatal("ordinary email was granted")
	}
}

func TestIsAllowlistedMissingEnvGrantsNoOne(t *testing.T) {
	t.Setenv(EnvVar, "")
	if IsAllowlisted("admin@example.com") {
		t.Fatal("missing configuration must grant no one")
	}
}
