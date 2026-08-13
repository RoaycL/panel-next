package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type logicalIntegrationRow struct {
	ID    uint `gorm:"primaryKey"`
	Name  string
	Value *string
}

func TestLogicalDatabasePayloadRoundTrip(t *testing.T) {
	value := "all accounts"
	payload := `{"formatVersion":1,"tables":[{"name":"user","columns":["id","name","token"],"rows":[["7","all accounts",null]]}]}`
	path := filepath.Join(t.TempDir(), "database.json")
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	decoded, err := readLogicalDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := validateLogicalDatabaseSchema(decoded, []LogicalTableSpec{{Name: "user", OrderBy: "id"}}, func(string) ([]string, error) {
		return []string{"id", "name", "token"}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	row := tables["user"].Rows[0]
	if row[0] == nil || *row[0] != "7" || row[1] == nil || *row[1] != value || row[2] != nil {
		t.Fatalf("unexpected decoded row: %#v", row)
	}
}

func TestConvertLogicalMySQLTimestamp(t *testing.T) {
	value := "2026-08-09T20:00:00+08:00"
	converted := convertLogicalValue("mysql", "datetime", &value)
	parsed, ok := converted.(time.Time)
	if !ok || parsed.Format(time.RFC3339) != value {
		t.Fatalf("unexpected converted timestamp: %#v", converted)
	}
}

func TestConvertLogicalPostgresTimestamp(t *testing.T) {
	value := "2026-08-09T12:34:56.123456Z"
	converted := convertLogicalValue("postgres", "timestamptz", &value)
	if _, ok := converted.(time.Time); !ok {
		t.Fatalf("expected PostgreSQL timestamp to convert to time.Time, got %T", converted)
	}
}

func TestLogicalDatabaseSQLiteIntegrationRoundTrip(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&logicalIntegrationRow{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&logicalIntegrationRow{ID: 7, Name: "all accounts"}).Error; err != nil {
		t.Fatal(err)
	}
	exportPath := filepath.Join(t.TempDir(), "database.json")
	specs := []LogicalTableSpec{{Name: "logical_integration_row", OrderBy: "id"}}
	if err := ExportLogicalDatabase(context.Background(), db, exportPath, specs); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DELETE FROM "logical_integration_row"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&logicalIntegrationRow{ID: 99, Name: "stale"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := ImportLogicalDatabase(context.Background(), db, exportPath, specs); err != nil {
		t.Fatal(err)
	}
	var rows []logicalIntegrationRow
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != 7 || rows[0].Name != "all accounts" || rows[0].Value != nil {
		t.Fatalf("unexpected restored rows: %#v", rows)
	}
}

func TestLogicalDatabaseRejectsUnknownTable(t *testing.T) {
	payload := LogicalDatabase{
		FormatVersion: LogicalDatabaseFormatVersion,
		Tables:        []LogicalTable{{Name: "not_allowed", Columns: []string{"id"}, Rows: [][]*string{{stringPointer("1")}}}},
	}
	_, err := validateLogicalDatabaseSchema(payload, []LogicalTableSpec{{Name: "user", OrderBy: "id"}}, func(string) ([]string, error) {
		return []string{"id"}, nil
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestLogicalBackupExcludesInstallationAndSessionState(t *testing.T) {
	configured := make(map[string]bool, len(SunPanelLogicalTables))
	for _, table := range SunPanelLogicalTables {
		configured[table.Name] = true
	}
	for _, excluded := range []string{"instance_metadata", "user_session", "user_session_refresh_token", "user_sync_state", "user_sync_change"} {
		if configured[excluded] {
			t.Fatalf("security-local table %q must not enter business backups", excluded)
		}
	}
}

func TestLogicalDatabaseRejectsSchemaMismatch(t *testing.T) {
	payload := LogicalDatabase{
		FormatVersion: LogicalDatabaseFormatVersion,
		Tables:        []LogicalTable{{Name: "user", Columns: []string{"id", "injected"}, Rows: [][]*string{{stringPointer("1"), stringPointer("x")}}}},
	}
	_, err := validateLogicalDatabaseSchema(payload, []LogicalTableSpec{{Name: "user", OrderBy: "id"}}, func(string) ([]string, error) {
		return []string{"id", "name"}, nil
	})
	if err == nil {
		t.Fatal("expected schema mismatch")
	}
}

func TestLogicalDatabaseAllowsOnlyDeclaredMigrationColumnsToBeMissing(t *testing.T) {
	payload := LogicalDatabase{
		FormatVersion: LogicalDatabaseFormatVersion,
		Tables: []LogicalTable{{
			Name: "item_icon", Columns: []string{"id", "title"},
			Rows: [][]*string{{stringPointer("1"), stringPointer("Example")}},
		}},
	}
	schema := func(string) ([]string, error) {
		return []string{"id", "title", "revision"}, nil
	}
	if _, err := validateLogicalDatabaseSchema(payload, []LogicalTableSpec{{
		Name: "item_icon", OrderBy: "id", OptionalOnRestore: []string{"revision"},
	}}, schema); err != nil {
		t.Fatalf("pre-revision backup should remain restorable: %v", err)
	}
	if _, err := validateLogicalDatabaseSchema(payload, []LogicalTableSpec{{
		Name: "item_icon", OrderBy: "id",
	}}, schema); err == nil {
		t.Fatal("missing undeclared schema column was accepted")
	}
}

func stringPointer(value string) *string {
	return &value
}
