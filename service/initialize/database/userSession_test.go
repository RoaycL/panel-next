package database

import (
	"testing"
	"time"

	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUserSessionMigrationAndDeviceIsolation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSession{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	session := models.UserSession{
		ID: "18ea3e5c-f78d-4d6e-a5ca-fd58e88d41da", UserID: 7,
		DeviceID: "device-a", DeviceName: "Test browser", ClientType: models.SessionClientWeb,
		AccessTokenHash:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RefreshTokenHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		AccessExpiresAt:  now.Add(15 * time.Minute), RefreshExpiresAt: now.Add(30 * 24 * time.Hour), LastActiveAt: now,
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	duplicateDevice := session
	duplicateDevice.ID = "a1b152b5-7648-4712-a23d-88da023e3eae"
	duplicateDevice.AccessTokenHash = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	duplicateDevice.RefreshTokenHash = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	if err := db.Create(&duplicateDevice).Error; err == nil {
		t.Fatal("expected duplicate user/device/client session to be rejected")
	}
	var stored models.UserSession
	if err := db.First(&stored, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AccessTokenHash != session.AccessTokenHash || stored.RefreshTokenHash != session.RefreshTokenHash {
		t.Fatal("token hashes were not persisted as expected")
	}
}
