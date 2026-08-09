package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCreateValidateExtractRoundTrip(t *testing.T) {
	root := t.TempDir()
	uploads := filepath.Join(root, "uploads")
	custom := filepath.Join(root, "custom")
	mustWrite(t, filepath.Join(uploads, "icons", "one.txt"), "icon-data")
	mustWrite(t, filepath.Join(custom, "index.css"), "body{}")
	mustWrite(t, filepath.Join(root, "database.db"), "sqlite-data")

	var output bytes.Buffer
	createdAt := time.Date(2026, 8, 9, 10, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	manifest, err := Create(context.Background(), &output, CreateOptions{
		Application: "sun-panel",
		CreatedAt:   createdAt,
		Database:    Database{Driver: "sqlite", Mode: "snapshot"},
		Sources: []Source{
			{ArchivePath: "database/database.db", LocalPath: filepath.Join(root, "database.db")},
			{ArchivePath: "uploads", LocalPath: uploads},
			{ArchivePath: "custom", LocalPath: custom},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(manifest.Entries))
	}

	validated, err := Validate(bytes.NewReader(output.Bytes()), int64(output.Len()), DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if !validated.CreatedAt.Equal(createdAt.UTC()) {
		t.Fatalf("unexpected timestamp: %s", validated.CreatedAt)
	}

	destination := filepath.Join(root, "restore")
	if _, err := Extract(bytes.NewReader(output.Bytes()), int64(output.Len()), destination, DefaultLimits()); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(destination, "database", "database.db"), "sqlite-data")
	assertFile(t, filepath.Join(destination, "uploads", "icons", "one.txt"), "icon-data")
	assertFile(t, filepath.Join(destination, "custom", "index.css"), "body{}")
}

func TestValidateRejectsTraversal(t *testing.T) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	entry, err := writer.Create("../database.db")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("bad"))
	manifest, _ := writer.Create(ManifestPath)
	_, _ = manifest.Write([]byte(`{"formatVersion":1,"application":"sun-panel","createdAt":"2026-08-09T00:00:00Z","database":{"driver":"sqlite","mode":"snapshot"},"entries":[]}`))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = Validate(bytes.NewReader(output.Bytes()), int64(output.Len()), DefaultLimits())
	if !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("expected invalid archive, got %v", err)
	}
}

func TestValidateRejectsFutureFormat(t *testing.T) {
	archive := archiveWithManifest(t, `{"formatVersion":2,"application":"sun-panel","createdAt":"2026-08-09T00:00:00Z","database":{"driver":"sqlite","mode":"snapshot"},"entries":[]}`)
	_, err := Validate(bytes.NewReader(archive), int64(len(archive)), DefaultLimits())
	if !errors.Is(err, ErrFutureFormat) {
		t.Fatalf("expected future format error, got %v", err)
	}
}

func TestValidateRejectsChecksumMismatch(t *testing.T) {
	manifest := `{"formatVersion":1,"application":"sun-panel","createdAt":"2026-08-09T00:00:00Z","database":{"driver":"sqlite","mode":"snapshot"},"entries":[{"path":"uploads/a.txt","size":3,"sha256":"` + strings.Repeat("0", 64) + `"}]}`
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	entry, _ := writer.Create("uploads/a.txt")
	_, _ = entry.Write([]byte("abc"))
	manifestEntry, _ := writer.Create(ManifestPath)
	_, _ = manifestEntry.Write([]byte(manifest))
	_ = writer.Close()
	_, err := Validate(bytes.NewReader(output.Bytes()), int64(output.Len()), DefaultLimits())
	if !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("expected invalid archive, got %v", err)
	}
}

func TestCreateRejectsSymlinkWhenSupported(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.txt")
	mustWrite(t, target, "data")
	link := filepath.Join(root, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks are not available: %v", err)
	}
	var output bytes.Buffer
	_, err := Create(context.Background(), &output, CreateOptions{Sources: []Source{{ArchivePath: "uploads/link.txt", LocalPath: link}}})
	if !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("expected invalid archive, got %v", err)
	}
}

func archiveWithManifest(t *testing.T, manifest string) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	entry, err := writer.Create(ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte(manifest))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
}

func assertFile(t *testing.T, path, expected string) {
	t.Helper()
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != expected {
		t.Fatalf("unexpected contents for %s: %q", path, actual)
	}
}
