package backup

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
)

const LogicalDatabaseFormatVersion = 1

var SunPanelLogicalTables = []LogicalTableSpec{
	{Name: "user", OrderBy: "id"},
	{Name: "system_setting", OrderBy: "id"},
	{Name: "item_icon_group", OrderBy: "id", OptionalOnRestore: []string{"revision"}},
	{Name: "item_icon", OrderBy: "id", OptionalOnRestore: []string{"revision"}},
	{Name: "user_config", OrderBy: "user_id", OptionalOnRestore: []string{"revision", "updated_at"}},
	{Name: "file", OrderBy: "id"},
	{Name: "public_file", OrderBy: "id"},
	{Name: "module_config", OrderBy: "id"},
}

type LogicalTableSpec struct {
	Name              string
	OrderBy           string
	OptionalOnRestore []string
}

type LogicalDatabase struct {
	FormatVersion int            `json:"formatVersion"`
	Tables        []LogicalTable `json:"tables"`
}

type LogicalTable struct {
	Name    string      `json:"name"`
	Columns []string    `json:"columns"`
	Rows    [][]*string `json:"rows"`
}

func ExportLogicalDatabase(ctx context.Context, db *gorm.DB, destination string, specs []LogicalTableSpec) (err error) {
	if db == nil {
		return errors.New("database is not initialized")
	}
	payload := LogicalDatabase{FormatVersion: LogicalDatabaseFormatVersion}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, spec := range specs {
			table, err := readLogicalTable(tx, spec)
			if err != nil {
				return err
			}
			payload.Tables = append(payload.Tables, table)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return err
	}

	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	removeOnError := true
	defer func() {
		if closeErr := output.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
		if removeOnError || err != nil {
			_ = os.Remove(destination)
		}
	}()
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(payload); err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	removeOnError = false
	return nil
}

func ImportLogicalDatabase(ctx context.Context, db *gorm.DB, source string, specs []LogicalTableSpec) error {
	return ImportLogicalDatabaseWithTxHook(ctx, db, source, specs, nil)
}

// ImportLogicalDatabaseWithTxHook runs the optional hook in the same database
// transaction after all portable business tables have been restored.
func ImportLogicalDatabaseWithTxHook(ctx context.Context, db *gorm.DB, source string, specs []LogicalTableSpec, hook func(*gorm.DB) error) error {
	if db == nil {
		return errors.New("database is not initialized")
	}
	payload, err := readLogicalDatabase(source)
	if err != nil {
		return err
	}
	tables, err := validateLogicalDatabase(db, payload, specs)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := len(specs) - 1; i >= 0; i-- {
			if err := tx.Exec("DELETE FROM " + quoteIdentifier(tx, specs[i].Name)).Error; err != nil {
				return fmt.Errorf("clear table %q: %w", specs[i].Name, err)
			}
		}
		for _, spec := range specs {
			table := tables[spec.Name]
			if len(table.Rows) > 0 {
				columns := make([]string, len(table.Columns))
				placeholders := make([]string, len(table.Columns))
				for i, column := range table.Columns {
					columns[i] = quoteIdentifier(tx, column)
					placeholders[i] = "?"
				}
				query := "INSERT INTO " + quoteIdentifier(tx, table.Name) + " (" + strings.Join(columns, ",") + ") VALUES (" + strings.Join(placeholders, ",") + ")"
				columnTypes, err := tx.Migrator().ColumnTypes(table.Name)
				if err != nil {
					return fmt.Errorf("inspect table %q: %w", table.Name, err)
				}
				databaseTypes := make(map[string]string, len(columnTypes))
				for _, columnType := range columnTypes {
					databaseTypes[columnType.Name()] = columnType.DatabaseTypeName()
				}
				for rowIndex, row := range table.Rows {
					values := make([]any, len(row))
					for i, value := range row {
						values[i] = convertLogicalValue(tx.Dialector.Name(), databaseTypes[table.Columns[i]], value)
					}
					if err := tx.Exec(query, values...).Error; err != nil {
						return fmt.Errorf("restore table %q row %d: %w", table.Name, rowIndex, err)
					}
				}
			}
			if tx.Dialector.Name() == "postgres" && containsColumn(table.Columns, "id") {
				quotedTable := quoteIdentifier(tx, table.Name)
				query := "SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM " + quotedTable
				if err := tx.Exec(query, quotedTable).Error; err != nil {
					return fmt.Errorf("reset sequence for table %q: %w", table.Name, err)
				}
			}
		}
		if hook != nil {
			return hook(tx)
		}
		return nil
	})
}

func containsColumn(columns []string, target string) bool {
	for _, column := range columns {
		if column == target {
			return true
		}
	}
	return false
}

func convertLogicalValue(dialect, databaseType string, value *string) any {
	if value == nil {
		return nil
	}
	if dialect == "mysql" || dialect == "postgres" {
		typeName := strings.ToUpper(databaseType)
		if strings.Contains(typeName, "DATE") || strings.Contains(typeName, "TIME") {
			if parsed, err := time.Parse(time.RFC3339Nano, *value); err == nil {
				return parsed
			}
		}
	}
	return *value
}

func readLogicalTable(db *gorm.DB, spec LogicalTableSpec) (LogicalTable, error) {
	query := "SELECT * FROM " + quoteIdentifier(db, spec.Name)
	if spec.OrderBy != "" {
		query += " ORDER BY " + quoteIdentifier(db, spec.OrderBy)
	}
	rows, err := db.Raw(query).Rows()
	if err != nil {
		return LogicalTable{}, fmt.Errorf("read table %q: %w", spec.Name, err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return LogicalTable{}, err
	}
	table := LogicalTable{Name: spec.Name, Columns: columns}
	for rows.Next() {
		raw := make([]sql.RawBytes, len(columns))
		destinations := make([]any, len(columns))
		for i := range raw {
			destinations[i] = &raw[i]
		}
		if err := rows.Scan(destinations...); err != nil {
			return LogicalTable{}, err
		}
		row := make([]*string, len(columns))
		for i, value := range raw {
			if value == nil {
				continue
			}
			text := string(append([]byte(nil), value...))
			row[i] = &text
		}
		table.Rows = append(table.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return LogicalTable{}, err
	}
	return table, nil
}

func readLogicalDatabase(source string) (LogicalDatabase, error) {
	input, err := os.Open(source)
	if err != nil {
		return LogicalDatabase{}, err
	}
	defer input.Close()
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	var payload LogicalDatabase
	if err := decoder.Decode(&payload); err != nil {
		return LogicalDatabase{}, fmt.Errorf("decode logical database: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return LogicalDatabase{}, errors.New("logical database contains trailing data")
	}
	return payload, nil
}

func validateLogicalDatabase(db *gorm.DB, payload LogicalDatabase, specs []LogicalTableSpec) (map[string]LogicalTable, error) {
	return validateLogicalDatabaseSchema(payload, specs, func(table string) ([]string, error) {
		actualTypes, err := db.Migrator().ColumnTypes(table)
		if err != nil {
			return nil, err
		}
		columns := make([]string, len(actualTypes))
		for i, column := range actualTypes {
			columns[i] = column.Name()
		}
		return columns, nil
	})
}

func validateLogicalDatabaseSchema(payload LogicalDatabase, specs []LogicalTableSpec, schema func(table string) ([]string, error)) (map[string]LogicalTable, error) {
	if payload.FormatVersion != LogicalDatabaseFormatVersion {
		return nil, fmt.Errorf("unsupported logical database format %d", payload.FormatVersion)
	}
	allowed := make(map[string]LogicalTableSpec, len(specs))
	for _, spec := range specs {
		allowed[spec.Name] = spec
	}
	tables := make(map[string]LogicalTable, len(payload.Tables))
	totalRows := 0
	for _, table := range payload.Tables {
		spec, ok := allowed[table.Name]
		if !ok {
			return nil, fmt.Errorf("unexpected logical table %q", table.Name)
		}
		if _, duplicate := tables[table.Name]; duplicate {
			return nil, fmt.Errorf("duplicate logical table %q", table.Name)
		}
		if len(table.Columns) == 0 {
			return nil, fmt.Errorf("logical table %q has no columns", table.Name)
		}
		actualColumns, err := schema(table.Name)
		if err != nil {
			return nil, fmt.Errorf("inspect table %q: %w", table.Name, err)
		}
		actual := make(map[string]struct{}, len(actualColumns))
		for _, column := range actualColumns {
			actual[column] = struct{}{}
		}
		seenColumns := make(map[string]struct{}, len(table.Columns))
		for _, column := range table.Columns {
			if _, ok := actual[column]; !ok {
				return nil, fmt.Errorf("unexpected column %q in table %q", column, table.Name)
			}
			if _, duplicate := seenColumns[column]; duplicate {
				return nil, fmt.Errorf("duplicate column %q in table %q", column, table.Name)
			}
			seenColumns[column] = struct{}{}
		}
		optional := make(map[string]struct{}, len(spec.OptionalOnRestore))
		for _, column := range spec.OptionalOnRestore {
			optional[column] = struct{}{}
		}
		for column := range actual {
			if _, present := seenColumns[column]; present {
				continue
			}
			if _, allowedMissing := optional[column]; !allowedMissing {
				return nil, fmt.Errorf("logical table %q does not match the current schema", table.Name)
			}
		}
		for _, row := range table.Rows {
			if len(row) != len(table.Columns) {
				return nil, fmt.Errorf("logical table %q contains a malformed row", table.Name)
			}
		}
		totalRows += len(table.Rows)
		if totalRows > 1_000_000 {
			return nil, errors.New("logical database row count exceeds limit")
		}
		tables[table.Name] = table
	}
	if len(tables) != len(specs) {
		return nil, errors.New("logical database is missing required tables")
	}
	return tables, nil
}

func quoteIdentifier(db *gorm.DB, identifier string) string {
	if db.Dialector.Name() == "mysql" {
		return "`" + strings.ReplaceAll(identifier, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
