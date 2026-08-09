package backup

import (
	"fmt"
	"strings"
)

const (
	DatabaseSQLitePath = "database/database.db"
	UploadsPrefix      = "uploads/"
	CustomPrefix       = "custom/"
)

func ValidateSunPanelLayout(manifest Manifest) error {
	if manifest.Database.Driver != "sqlite" {
		return fmt.Errorf("%w: unsupported database driver %q", ErrInvalidArchive, manifest.Database.Driver)
	}
	if manifest.Database.Mode != "snapshot" {
		return fmt.Errorf("%w: unsupported database backup mode %q", ErrInvalidArchive, manifest.Database.Mode)
	}
	foundDatabase := false
	for _, entry := range manifest.Entries {
		switch {
		case entry.Path == DatabaseSQLitePath:
			foundDatabase = true
		case strings.HasPrefix(entry.Path, UploadsPrefix):
		case strings.HasPrefix(entry.Path, CustomPrefix):
		default:
			return fmt.Errorf("%w: unsupported Sun-Panel path %q", ErrInvalidArchive, entry.Path)
		}
	}
	if !foundDatabase {
		return fmt.Errorf("%w: missing SQLite database snapshot", ErrInvalidArchive)
	}
	return nil
}
