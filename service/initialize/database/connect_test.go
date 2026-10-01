package database

import (
	"encoding/json"
	"testing"

	"panel-next/lib/cmn"
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
	if application["loginCaptcha"] != false || application["openRegister"] != true {
		t.Fatalf("unexpected application defaults: %#v", application)
	}
	if err := db.Model(&models.SystemSetting{}).Where("config_name = ?", "system_application").Update("config_value", `{"openRegister":false,"custom":"preserve"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultSystemSettings(db); err != nil {
		t.Fatal(err)
	}
	var existing models.SystemSetting
	if err := db.First(&existing, "config_name = ?", "system_application").Error; err != nil {
		t.Fatal(err)
	}
	if existing.ConfigValue != `{"openRegister":false,"custom":"preserve"}` {
		t.Fatal("upgrade changed existing registration policy")
	}
}

func TestInitialAdminAndExistingUserPreservation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	if err := NotFoundAndCreateUser(db); err != nil {
		t.Fatal(err)
	}
	var user models.User
	if err := db.First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.Username != "admin" || user.Mail != "" || user.Role != 1 || !cmn.VerifyPassword(user.Password, "admin123") {
		t.Fatalf("unexpected default admin: %+v", user)
	}
	if err := db.Model(&user).Updates(map[string]interface{}{"username": "existing-admin", "password": "unchanged-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := NotFoundAndCreateUser(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.Username != "existing-admin" || user.Password != "unchanged-hash" {
		t.Fatal("initialization overwrote an existing account")
	}
	var count int64
	db.Model(&models.User{}).Count(&count)
	if count != 1 {
		t.Fatal("initialization created a second administrator")
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
