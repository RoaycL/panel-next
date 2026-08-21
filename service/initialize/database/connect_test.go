package database

import (
	"encoding/json"
	"testing"

	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEnsureDefaultSystemSettingsIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultSystemSettings(db); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultSystemSettings(db); err != nil {
		t.Fatal(err)
	}
	var settings []models.SystemSetting
	if err := db.Order("config_name").Find(&settings).Error; err != nil {
		t.Fatal(err)
	}
	if len(settings) != 3 {
		t.Fatalf("expected three default settings, got %d", len(settings))
	}
	var application map[string]any
	if err := json.Unmarshal([]byte(settings[1].ConfigValue), &application); err != nil {
		t.Fatalf("invalid application setting JSON: %v", err)
	}
	if application["loginCaptcha"] != false || application["openRegister"] != false {
		t.Fatalf("unexpected application defaults: %#v", application)
	}
}

func TestEnsureInstanceMetadataIsStable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.InstanceMetadata{}); err != nil {
		t.Fatal(err)
	}
	first, err := EnsureInstanceMetadata(db)
	if err != nil {
		t.Fatal(err)
	}
	second, err := EnsureInstanceMetadata(db)
	if err != nil {
		t.Fatal(err)
	}
	if first == "" || first != second {
		t.Fatalf("instance id is not stable: first=%q second=%q", first, second)
	}
	var count int64
	if err := db.Model(&models.InstanceMetadata{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one metadata row, got %d", count)
	}
}
