package backup

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestApplyArchiveReplacesConfiguredTargets(t *testing.T) {
	root := t.TempDir()
	sources := filepath.Join(root, "sources")
	mustWrite(t, filepath.Join(sources, "database.db"), "new-database")
	mustWrite(t, filepath.Join(sources, "uploads", "icon.txt"), "new-icon")
	mustWrite(t, filepath.Join(sources, "custom", "index.css"), "new-css")

	var buffer bytes.Buffer
	_, err := Create(context.Background(), &buffer, CreateOptions{
		Database: Database{Driver: "sqlite", Mode: "snapshot"},
		Sources: []Source{
			{ArchivePath: DatabaseSQLitePath, LocalPath: filepath.Join(sources, "database.db")},
			{ArchivePath: "uploads", LocalPath: filepath.Join(sources, "uploads")},
			{ArchivePath: "custom", LocalPath: filepath.Join(sources, "custom")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	pending := filepath.Join(root, "restore-pending.zip")
	if err := os.WriteFile(pending, buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}

	database := filepath.Join(root, "current", "database.db")
	uploads := filepath.Join(root, "current", "uploads")
	custom := filepath.Join(root, "current", "custom")
	mustWrite(t, database, "old-database")
	mustWrite(t, filepath.Join(uploads, "old.txt"), "old-icon")
	mustWrite(t, filepath.Join(custom, "old.css"), "old-css")

	_, err = ApplyArchive(pending, []RestoreTarget{
		{ArchivePath: DatabaseSQLitePath, Destination: database},
		{ArchivePath: "uploads", Destination: uploads, Directory: true},
		{ArchivePath: "custom", Destination: custom, Directory: true},
	}, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	assertFile(t, database, "new-database")
	assertFile(t, filepath.Join(uploads, "icon.txt"), "new-icon")
	assertFile(t, filepath.Join(custom, "index.css"), "new-css")
	if _, err := os.Stat(filepath.Join(uploads, "old.txt")); !os.IsNotExist(err) {
		t.Fatalf("old upload should be removed, got %v", err)
	}
	if _, err := os.Stat(pending); !os.IsNotExist(err) {
		t.Fatalf("pending archive should be removed, got %v", err)
	}
}

func TestApplyArchiveRejectsOverlappingTargets(t *testing.T) {
	root := t.TempDir()
	_, err := prepareTargets(root, []RestoreTarget{
		{ArchivePath: "uploads", Destination: filepath.Join(root, "data"), Directory: true},
		{ArchivePath: "custom", Destination: filepath.Join(root, "data", "custom"), Directory: true},
	})
	if err == nil {
		t.Fatal("expected overlapping target error")
	}
}

func TestApplyArchiveRollsBackFilesWhenHookFails(t *testing.T) {
	root := t.TempDir()
	sources := filepath.Join(root, "sources")
	mustWrite(t, filepath.Join(sources, "database.json"), `{}`)
	mustWrite(t, filepath.Join(sources, "uploads", "new.txt"), "new")

	var buffer bytes.Buffer
	_, err := Create(context.Background(), &buffer, CreateOptions{
		Database: Database{Driver: "mysql", Mode: "logical"},
		Sources: []Source{
			{ArchivePath: DatabaseLogicalPath, LocalPath: filepath.Join(sources, "database.json")},
			{ArchivePath: "uploads", LocalPath: filepath.Join(sources, "uploads")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	pending := filepath.Join(root, "restore-pending.zip")
	if err := os.WriteFile(pending, buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	uploads := filepath.Join(root, "current", "uploads")
	mustWrite(t, filepath.Join(uploads, "old.txt"), "old")

	_, err = ApplyArchiveWithHook(pending, []RestoreTarget{{ArchivePath: "uploads", Destination: uploads, Directory: true}}, DefaultLimits(), func(Manifest, string) error {
		return bytes.ErrTooLarge
	})
	if err == nil {
		t.Fatal("expected hook failure")
	}
	assertFile(t, filepath.Join(uploads, "old.txt"), "old")
	if _, err := os.Stat(filepath.Join(uploads, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("new upload should have been rolled back, got %v", err)
	}
	if _, err := os.Stat(pending); err != nil {
		t.Fatalf("pending archive should remain after rollback: %v", err)
	}
}
