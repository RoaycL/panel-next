package session

import "time"

const DefaultLegacyTokenUntil = "2026-11-07T00:00:00Z"

func LegacyTokenCompatibilityActive(rawDeadline string, now time.Time) bool {
	deadline, ok := EffectiveLegacyTokenDeadline(rawDeadline)
	if !ok {
		return false
	}
	return now.UTC().Before(deadline.UTC())
}

func EffectiveLegacyTokenDeadline(rawDeadline string) (time.Time, bool) {
	configured, err := time.Parse(time.RFC3339, rawDeadline)
	if err != nil {
		return time.Time{}, false
	}
	maximum, err := time.Parse(time.RFC3339, DefaultLegacyTokenUntil)
	if err != nil {
		return time.Time{}, false
	}
	if configured.After(maximum) {
		return maximum, true
	}
	return configured, true
}
