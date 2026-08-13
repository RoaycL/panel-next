package session

import (
	"testing"
	"time"
)

func TestLegacyTokenCompatibilityHasHardDeadline(t *testing.T) {
	deadline, err := time.Parse(time.RFC3339, DefaultLegacyTokenUntil)
	if err != nil {
		t.Fatal(err)
	}
	if !LegacyTokenCompatibilityActive(DefaultLegacyTokenUntil, deadline.Add(-time.Nanosecond)) {
		t.Fatal("legacy compatibility closed before its deadline")
	}
	if LegacyTokenCompatibilityActive(DefaultLegacyTokenUntil, deadline) {
		t.Fatal("legacy compatibility remained active at its deadline")
	}
	if LegacyTokenCompatibilityActive("invalid", deadline.Add(-time.Hour)) {
		t.Fatal("invalid deadline must fail closed")
	}
	if LegacyTokenCompatibilityActive("2099-01-01T00:00:00Z", deadline) {
		t.Fatal("configuration extended compatibility beyond the compiled hard deadline")
	}
}
