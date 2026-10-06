package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerConfigDefaultsToSQLite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "conf.ini")
	if err := os.WriteFile(path, []byte("[base]\nhttp_port=3002\ndatabase_drive=postgres\ncache_drive=memory\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := useSQLiteByDefault(path); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(path)
	if !strings.Contains(string(content), "\ndatabase_drive=sqlite\n") || strings.Contains(string(content), "postgres") {
		t.Fatalf("generated Docker config still needs PostgreSQL: %s", content)
	}
}
