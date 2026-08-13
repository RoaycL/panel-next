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

func TestValidateSunPanelLogicalLayout(t *testing.T) {
	valid := Manifest{
		Database: Database{Driver: "mysql", Mode: "logical"},
		Entries: []Entry{
			{Path: DatabaseLogicalPath},
			{Path: "uploads/2026/icon.png"},
		},
	}
	if err := ValidateSunPanelLayout(valid); err != nil {
		t.Fatal(err)
	}
	valid.Entries[0].Path = DatabaseSQLitePath
	if err := ValidateSunPanelLayout(valid); !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("expected invalid archive, got %v", err)
	}
}

func TestValidateSunPanelPostgresLogicalLayout(t *testing.T) {
	valid := Manifest{
		Database: Database{Driver: "postgres", Mode: "logical"},
		Entries:  []Entry{{Path: DatabaseLogicalPath}},
	}
	if err := ValidateSunPanelLayout(valid); err != nil {
		t.Fatalf("expected PostgreSQL logical backup layout to be valid: %v", err)
	}
}
