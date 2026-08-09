package backup

import (
	"errors"
	"testing"
)

func TestValidateSunPanelLayout(t *testing.T) {
	valid := Manifest{
		Database: Database{Driver: "sqlite", Mode: "snapshot"},
		Entries: []Entry{
			{Path: DatabaseSQLitePath},
			{Path: "uploads/2026/icon.png"},
			{Path: "custom/index.css"},
		},
	}
	if err := ValidateSunPanelLayout(valid); err != nil {
		t.Fatal(err)
	}

	invalid := valid
	invalid.Entries = append(invalid.Entries, Entry{Path: "conf/conf.ini"})
	if err := ValidateSunPanelLayout(invalid); !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("expected invalid archive, got %v", err)
	}
}
