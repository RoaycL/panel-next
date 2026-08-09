package initialize

import (
	"context"
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
	driver := global.Config.GetValueStringOrDefault("base", "database_drive")
	targets := []backuplib.RestoreTarget{
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
	}
	switch driver {
	case "sqlite":
		targets = append(targets, backuplib.RestoreTarget{
			ArchivePath: backuplib.DatabaseSQLitePath,
			Destination: global.Config.GetValueStringOrDefault("sqlite", "file_path"),
		})
		_, err := backuplib.ApplyArchive(pendingPath, targets, backuplib.DefaultLimits())
		return err
	case "mysql":
		_, err := backuplib.ApplyArchiveWithHook(pendingPath, targets, backuplib.DefaultLimits(), func(_ backuplib.Manifest, extractRoot string) error {
			return backuplib.ImportLogicalDatabase(context.Background(), global.Db, filepath.Join(extractRoot, filepath.FromSlash(backuplib.DatabaseLogicalPath)), backuplib.SunPanelLogicalTables)
		})
		return err
	default:
		return fmt.Errorf("pending restore uses unsupported database driver %q", driver)
	}
}
