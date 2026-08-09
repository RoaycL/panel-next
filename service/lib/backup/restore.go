package backup

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type RestoreTarget struct {
	ArchivePath string
	Destination string
	Directory   bool
}

type ApplyHook func(manifest Manifest, extractRoot string) error

type preparedTarget struct {
	target          RestoreTarget
	stageRoot       string
	stagePayload    string
	rollbackRoot    string
	rollbackPayload string
	hadOriginal     bool
	applied         bool
}

func ApplyArchive(archivePath string, targets []RestoreTarget, limits Limits) (Manifest, error) {
	return ApplyArchiveWithHook(archivePath, targets, limits, nil)
}

func ApplyArchiveWithHook(archivePath string, targets []RestoreTarget, limits Limits, hook ApplyHook) (Manifest, error) {
	archiveFile, err := os.Open(archivePath)
	if err != nil {
		return Manifest{}, err
	}
	info, err := archiveFile.Stat()
	if err != nil {
		_ = archiveFile.Close()
		return Manifest{}, err
	}
	manifest, err := Validate(archiveFile, info.Size(), limits)
	if err != nil {
		_ = archiveFile.Close()
		return Manifest{}, err
	}
	if err := ValidateSunPanelLayout(manifest); err != nil {
		_ = archiveFile.Close()
		return Manifest{}, err
	}

	extractRoot, err := os.MkdirTemp(filepath.Dir(archivePath), "restore-extract-*")
	if err != nil {
		_ = archiveFile.Close()
		return Manifest{}, err
	}
	defer os.RemoveAll(extractRoot)
	if _, err := Extract(archiveFile, info.Size(), extractRoot, limits); err != nil {
		_ = archiveFile.Close()
		return Manifest{}, err
	}
	if err := archiveFile.Close(); err != nil {
		return Manifest{}, err
	}

	prepared, err := prepareTargets(extractRoot, targets)
	if err != nil {
		return Manifest{}, err
	}
	defer func() {
		for i := range prepared {
			_ = os.RemoveAll(prepared[i].stageRoot)
			if !prepared[i].applied {
				_ = os.RemoveAll(prepared[i].rollbackRoot)
			}
		}
	}()

	for i := range prepared {
		if err := commitTarget(&prepared[i]); err != nil {
			rollbackErr := rollbackTargets(prepared[:i+1])
			if rollbackErr != nil {
				return Manifest{}, fmt.Errorf("apply restore: %w; rollback: %v", err, rollbackErr)
			}
			return Manifest{}, fmt.Errorf("apply restore: %w", err)
		}
	}
	if hook != nil {
		if err := hook(manifest, extractRoot); err != nil {
			rollbackErr := rollbackTargets(prepared)
			if rollbackErr != nil {
				return Manifest{}, fmt.Errorf("apply restore hook: %w; filesystem rollback: %v", err, rollbackErr)
			}
			return Manifest{}, fmt.Errorf("apply restore hook: %w", err)
		}
	}
	for i := range prepared {
		if err := os.RemoveAll(prepared[i].rollbackRoot); err != nil {
			return Manifest{}, fmt.Errorf("remove restore rollback data: %w", err)
		}
		prepared[i].applied = false
	}
	if err := os.Remove(archivePath); err != nil {
		return Manifest{}, fmt.Errorf("restore applied but pending archive could not be removed: %w", err)
	}
	return manifest, nil
}

func prepareTargets(extractRoot string, targets []RestoreTarget) ([]preparedTarget, error) {
	if len(targets) == 0 {
		return nil, errors.New("no restore targets configured")
	}
	cleanTargets := append([]RestoreTarget(nil), targets...)
	for i := range cleanTargets {
		archivePath, err := cleanArchivePath(cleanTargets[i].ArchivePath)
		if err != nil {
			return nil, err
		}
		cleanTargets[i].ArchivePath = archivePath
		destination, err := filepath.Abs(cleanTargets[i].Destination)
		if err != nil {
			return nil, err
		}
		volumeRoot := filepath.VolumeName(destination) + string(filepath.Separator)
		if filepath.Clean(destination) == filepath.Clean(volumeRoot) {
			return nil, fmt.Errorf("refusing to restore over filesystem root %q", destination)
		}
		cleanTargets[i].Destination = destination
	}
	sort.Slice(cleanTargets, func(i, j int) bool { return cleanTargets[i].Destination < cleanTargets[j].Destination })
	for i := 1; i < len(cleanTargets); i++ {
		previous := cleanTargets[i-1].Destination
		current := cleanTargets[i].Destination
		relative, err := filepath.Rel(previous, current)
		if err == nil && (relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))) {
			return nil, fmt.Errorf("restore destinations overlap: %q and %q", previous, current)
		}
	}

	prepared := make([]preparedTarget, 0, len(cleanTargets))
	for _, target := range cleanTargets {
		parent := filepath.Dir(target.Destination)
		if err := os.MkdirAll(parent, 0700); err != nil {
			return prepared, err
		}
		stageRoot, err := os.MkdirTemp(parent, ".sun-panel-restore-stage-*")
		if err != nil {
			return prepared, err
		}
		item := preparedTarget{target: target, stageRoot: stageRoot, stagePayload: filepath.Join(stageRoot, filepath.Base(target.Destination))}
		prepared = append(prepared, item)
		source := filepath.Join(extractRoot, filepath.FromSlash(target.ArchivePath))
		if target.Directory {
			if err := copyDirectoryOrEmpty(source, item.stagePayload); err != nil {
				return prepared, err
			}
		} else if err := copyRegularFile(source, item.stagePayload, 0600); err != nil {
			return prepared, err
		}
	}
	return prepared, nil
}

func commitTarget(target *preparedTarget) error {
	if info, err := os.Lstat(target.target.Destination); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing to replace symbolic link %q", target.target.Destination)
		}
		target.hadOriginal = true
	} else if !os.IsNotExist(err) {
		return err
	}
	rollbackRoot, err := os.MkdirTemp(filepath.Dir(target.target.Destination), ".sun-panel-restore-rollback-*")
	if err != nil {
		return err
	}
	target.rollbackRoot = rollbackRoot
	target.rollbackPayload = filepath.Join(rollbackRoot, filepath.Base(target.target.Destination))
	if target.hadOriginal {
		if err := os.Rename(target.target.Destination, target.rollbackPayload); err != nil {
			return err
		}
	}
	if err := os.Rename(target.stagePayload, target.target.Destination); err != nil {
		if target.hadOriginal {
			_ = os.Rename(target.rollbackPayload, target.target.Destination)
		}
		return err
	}
	target.applied = true
	return nil
}

func rollbackTargets(targets []preparedTarget) error {
	var rollbackErrors []error
	for i := len(targets) - 1; i >= 0; i-- {
		target := &targets[i]
		if !target.applied {
			continue
		}
		if err := os.RemoveAll(target.target.Destination); err != nil {
			rollbackErrors = append(rollbackErrors, err)
			continue
		}
		if target.hadOriginal {
			if err := os.Rename(target.rollbackPayload, target.target.Destination); err != nil {
				rollbackErrors = append(rollbackErrors, err)
				continue
			}
		}
		target.applied = false
	}
	return errors.Join(rollbackErrors...)
}

func copyDirectoryOrEmpty(source, destination string) error {
	info, err := os.Stat(source)
	if os.IsNotExist(err) {
		return os.MkdirAll(destination, 0700)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("expected directory %q", source)
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported restore source %q", path)
		}
		return copyRegularFile(path, target, 0600)
	})
}

func copyRegularFile(source, destination string, mode os.FileMode) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("restore source is not a regular file: %q", source)
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
