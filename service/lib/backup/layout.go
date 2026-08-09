package backup

import (
	"fmt"
	"strings"
)

const (
	DatabaseSQLitePath  = "database/database.db"
	DatabaseLogicalPath = "database/database.json"
	UploadsPrefix       = "uploads/"
	CustomPrefix        = "custom/"
)

func ValidateSunPanelLayout(manifest Manifest) error {
	databasePath := ""
	switch {
	case manifest.Database.Driver == "sqlite" && manifest.Database.Mode == "snapshot":
		databasePath = DatabaseSQLitePath
	case manifest.Database.Driver == "mysql" && manifest.Database.Mode == "logical":
		databasePath = DatabaseLogicalPath
	default:
		return fmt.Errorf("%w: unsupported database backup %q/%q", ErrInvalidArchive, manifest.Database.Driver, manifest.Database.Mode)
	}
	foundDatabase := false
	for _, entry := range manifest.Entries {
		switch {
		case entry.Path == databasePath:
			foundDatabase = true
		case strings.HasPrefix(entry.Path, UploadsPrefix):
		case strings.HasPrefix(entry.Path, CustomPrefix):
		default:
			return fmt.Errorf("%w: unsupported Sun-Panel path %q", ErrInvalidArchive, entry.Path)
		}
	}
	if !foundDatabase {
		return fmt.Errorf("%w: missing database payload", ErrInvalidArchive)
	}
	return nil
}
