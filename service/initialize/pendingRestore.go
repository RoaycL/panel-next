package initialize

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"panel-next/global"
	backuplib "panel-next/lib/backup"
	"panel-next/models"

	"gorm.io/gorm"
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
	case "mysql", "postgres":
		_, err := backuplib.ApplyArchiveWithHook(pendingPath, targets, backuplib.DefaultLimits(), func(_ backuplib.Manifest, extractRoot string) error {
			return backuplib.ImportLogicalDatabaseWithTxHook(
				context.Background(), global.Db,
				filepath.Join(extractRoot, filepath.FromSlash(backuplib.DatabaseLogicalPath)),
				backuplib.SunPanelLogicalTables, rebuildSyncStateAfterBusinessRestore,
			)
		})
		return err
	default:
		return fmt.Errorf("pending restore uses unsupported database driver %q", driver)
	}
}

// Change history is deliberately not portable. After a logical restore, seed
// each account cursor from restored resource revisions so bootstrap remains a
// safe baseline and stale pre-restore changes cannot be replayed.
func rebuildSyncStateAfterBusinessRestore(tx *gorm.DB) error {
	if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.UserSyncChange{}).Error; err != nil {
		return err
	}
	if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.UserSyncState{}).Error; err != nil {
		return err
	}
	var users []models.User
	if err := tx.Select("id").Find(&users).Error; err != nil {
		return err
	}
	for _, user := range users {
		maximum := int64(0)
		queries := []struct {
			model any
			key   string
		}{
			{model: &models.UserConfig{}, key: "user_id"},
			{model: &models.ItemIconGroup{}, key: "user_id"},
			{model: &models.ItemIcon{}, key: "user_id"},
		}
		for _, query := range queries {
			var candidate int64
			if err := tx.Model(query.model).Where(query.key+" = ?", user.ID).
				Select("COALESCE(MAX(revision), 0)").Scan(&candidate).Error; err != nil {
				return err
			}
			if candidate > maximum {
				maximum = candidate
			}
		}
		if err := tx.Create(&models.UserSyncState{UserID: user.ID, Revision: maximum}).Error; err != nil {
			return err
		}
	}
	return nil
}
