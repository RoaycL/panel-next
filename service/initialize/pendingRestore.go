package initialize

import (
	"fmt"
	"os"
	"path/filepath"
	"sun-panel/global"
	backuplib "sun-panel/lib/backup"
)

func ApplyPendingRestore() error {
	runtimePath := global.Config.GetValueStringOrDefault("base", "source_temp_path")
	pendingPath := filepath.Join(runtimePath, "restore-pending.zip")
	if _, err := os.Stat(pendingPath); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	if global.Config.GetValueStringOrDefault("base", "database_drive") != "sqlite" {
		return fmt.Errorf("pending restore requires the SQLite database driver")
	}
	_, err := backuplib.ApplyArchive(pendingPath, []backuplib.RestoreTarget{
		{
			ArchivePath: backuplib.DatabaseSQLitePath,
			Destination: global.Config.GetValueStringOrDefault("sqlite", "file_path"),
		},
		{
			ArchivePath: "uploads",
			Destination: global.Config.GetValueStringOrDefault("base", "source_path"),
			Directory:   true,
		},
		{
			ArchivePath: "custom",
			Destination: filepath.Join("web", "custom"),
			Directory:   true,
		},
	}, backuplib.DefaultLimits())
	return err
}
