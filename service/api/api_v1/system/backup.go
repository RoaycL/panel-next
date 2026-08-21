package system

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	backuplib "panel-next/lib/backup"
	"panel-next/lib/cmn"

	"github.com/gin-gonic/gin"
)

const maxBackupUploadSize int64 = 20 << 30

var backupOperationMutex sync.Mutex

type BackupApi struct{}

func (a *BackupApi) Export(c *gin.Context) {
	if !backupOperationMutex.TryLock() {
		apiReturn.Error(c, "Another backup or restore operation is already running")
		return
	}
	defer backupOperationMutex.Unlock()
	auditBackupOperation(c, "export", "started", nil)
	archivePath, cleanup, err := createCurrentBackup(c)
	if err != nil {
		auditBackupOperation(c, "export", "failed", err)
		apiReturn.Error(c, "Unable to create backup: "+err.Error())
		return
	}
	defer cleanup()

	filename := "panel-next-backup-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	c.Header("Cache-Control", "no-store")
	auditBackupOperation(c, "export", "completed", nil)
	c.FileAttachment(archivePath, filename)
}

func (a *BackupApi) Restore(c *gin.Context) {
	if !backupOperationMutex.TryLock() {
		apiReturn.Error(c, "Another backup or restore operation is already running")
		return
	}
	defer backupOperationMutex.Unlock()
	auditBackupOperation(c, "restore", "started", nil)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBackupUploadSize)
	upload, err := c.FormFile("backup")
	if err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	if upload.Size <= 0 || upload.Size > maxBackupUploadSize {
		apiReturn.Error(c, "Backup file size is invalid")
		return
	}

	runtimePath, err := ensureRuntimePath()
	if err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	pendingPath := filepath.Join(runtimePath, "restore-pending.zip")
	if _, err := os.Stat(pendingPath); err == nil {
		apiReturn.Error(c, "A restore is already pending; restart the service or remove the pending restore first")
		return
	} else if !os.IsNotExist(err) {
		apiReturn.Error(c, err.Error())
		return
	}

	temporary, err := os.CreateTemp(runtimePath, "restore-upload-*.zip")
	if err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	temporaryPath := temporary.Name()
	_ = temporary.Close()
	defer os.Remove(temporaryPath)
	if err := c.SaveUploadedFile(upload, temporaryPath); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}

	manifest, err := validateBackupFile(temporaryPath)
	if err != nil {
		auditBackupOperation(c, "restore", "validation_failed", err)
		apiReturn.Error(c, "Backup validation failed: "+err.Error())
		return
	}
	if manifest.Database.Driver != databaseDriver() {
		apiReturn.Error(c, "Backup database driver does not match the current installation")
		return
	}

	snapshotPath, snapshotCleanup, err := createCurrentBackup(c)
	if err != nil {
		apiReturn.Error(c, "Unable to create the mandatory pre-restore snapshot: "+err.Error())
		return
	}
	defer snapshotCleanup()
	preRestoreName := "pre-restore-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	preRestorePath := filepath.Join(runtimePath, preRestoreName)
	if err := copyFile(snapshotPath, preRestorePath, 0600); err != nil {
		apiReturn.Error(c, "Unable to preserve the pre-restore snapshot: "+err.Error())
		return
	}

	if err := os.Rename(temporaryPath, pendingPath); err != nil {
		auditBackupOperation(c, "restore", "failed", err)
		apiReturn.Error(c, "Unable to queue restore: "+err.Error())
		return
	}
	auditBackupOperation(c, "restore", "queued", nil)
	apiReturn.SuccessData(c, gin.H{
		"restartRequired":  true,
		"preRestoreBackup": preRestoreName,
		"formatVersion":    manifest.FormatVersion,
	})
}

func auditBackupOperation(c *gin.Context, operation, status string, operationErr error) {
	user, _ := base.GetCurrentUserInfo(c)
	if operationErr != nil {
		global.Logger.Errorf("AUDIT backup operation=%s status=%s user_id=%d ip=%s error=%v", operation, status, user.ID, c.ClientIP(), operationErr)
		return
	}
	global.Logger.Infof("AUDIT backup operation=%s status=%s user_id=%d ip=%s", operation, status, user.ID, c.ClientIP())
}

func createCurrentBackup(c *gin.Context) (archivePath string, cleanup func(), err error) {
	runtimePath, err := ensureRuntimePath()
	if err != nil {
		return "", func() {}, err
	}
	workspace, err := os.MkdirTemp(runtimePath, "backup-work-*")
	if err != nil {
		return "", func() {}, err
	}
	cleanup = func() { _ = os.RemoveAll(workspace) }

	driver := databaseDriver()
	databaseInfo := backuplib.Database{Driver: driver}
	var sources []backuplib.Source
	switch driver {
	case "sqlite":
		databaseSnapshot := filepath.Join(workspace, "database.db")
		escapedSnapshot := strings.ReplaceAll(filepath.ToSlash(databaseSnapshot), "'", "''")
		if result := global.Db.Exec("VACUUM INTO '" + escapedSnapshot + "'"); result.Error != nil {
			cleanup()
			return "", func() {}, result.Error
		}
		databaseInfo.Mode = "snapshot"
		sources = append(sources, backuplib.Source{ArchivePath: backuplib.DatabaseSQLitePath, LocalPath: databaseSnapshot})
	case "mysql", "postgres":
		logicalPath := filepath.Join(workspace, "database.json")
		if err := backuplib.ExportLogicalDatabase(c.Request.Context(), global.Db, logicalPath, backuplib.SunPanelLogicalTables); err != nil {
			cleanup()
			return "", func() {}, err
		}
		databaseInfo.Mode = "logical"
		sources = append(sources, backuplib.Source{ArchivePath: backuplib.DatabaseLogicalPath, LocalPath: logicalPath})
	default:
		cleanup()
		return "", func() {}, fmt.Errorf("unsupported database driver %q", driver)
	}
	uploadPath := global.Config.GetValueStringOrDefault("base", "source_path")
	if info, statErr := os.Stat(uploadPath); statErr == nil && info.IsDir() {
		sources = append(sources, backuplib.Source{ArchivePath: "uploads", LocalPath: uploadPath})
	} else if statErr != nil && !os.IsNotExist(statErr) {
		cleanup()
		return "", func() {}, statErr
	}
	customPath := filepath.Join("web", "custom")
	if info, statErr := os.Stat(customPath); statErr == nil && info.IsDir() {
		sources = append(sources, backuplib.Source{ArchivePath: "custom", LocalPath: customPath})
	} else if statErr != nil && !os.IsNotExist(statErr) {
		cleanup()
		return "", func() {}, statErr
	}

	archivePath = filepath.Join(workspace, "backup.zip")
	archive, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		cleanup()
		return "", func() {}, err
	}
	version := cmn.GetSysVersionInfo().Version
	_, createErr := backuplib.Create(c.Request.Context(), archive, backuplib.CreateOptions{
		Application:        "panel-next",
		ApplicationVersion: version,
		Database:           databaseInfo,
		Sources:            sources,
	})
	closeErr := archive.Close()
	if createErr != nil {
		cleanup()
		return "", func() {}, createErr
	}
	if closeErr != nil {
		cleanup()
		return "", func() {}, closeErr
	}
	return archivePath, cleanup, nil
}

func validateBackupFile(path string) (backuplib.Manifest, error) {
	file, err := os.Open(path)
	if err != nil {
		return backuplib.Manifest{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return backuplib.Manifest{}, err
	}
	manifest, err := backuplib.Validate(file, info.Size(), backuplib.DefaultLimits())
	if err != nil {
		return backuplib.Manifest{}, err
	}
	if err := backuplib.ValidateSunPanelLayout(manifest); err != nil {
		return backuplib.Manifest{}, err
	}
	return manifest, nil
}

func ensureRuntimePath() (string, error) {
	runtimePath := global.Config.GetValueStringOrDefault("base", "source_temp_path")
	if err := os.MkdirAll(runtimePath, 0700); err != nil {
		return "", err
	}
	return filepath.Abs(runtimePath)
}

func databaseDriver() string {
	return global.Config.GetValueStringOrDefault("base", "database_drive")
}

func copyFile(source, destination string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := output.ReadFrom(input); err != nil {
		_ = output.Close()
		_ = os.Remove(destination)
		return err
	}
	if err := output.Sync(); err != nil {
		_ = output.Close()
		_ = os.Remove(destination)
		return err
	}
	return output.Close()
}
