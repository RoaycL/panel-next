package database

import (
	"testing"

	"sun-panel/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type legacyItemIconGroup struct {
	ID     uint `gorm:"primaryKey"`
	Title  string
	UserId uint
}

func (legacyItemIconGroup) TableName() string { return "item_icon_group" }

type legacyItemIcon struct {
	ID              uint `gorm:"primaryKey"`
	Title           string
	UserId          uint
	ItemIconGroupId int
}

func (legacyItemIcon) TableName() string { return "item_icon" }

type legacyUserConfig struct {
	UserId           uint `gorm:"primaryKey"`
	PanelJson        string
	SearchEngineJson string
}

func (legacyUserConfig) TableName() string { return "user_config" }

func TestSyncRevisionMigrationPreservesExistingResources(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyItemIconGroup{}, &legacyItemIcon{}, &legacyUserConfig{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyItemIconGroup{ID: 2, Title: "Apps", UserId: 7}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyItemIcon{ID: 3, Title: "Example", UserId: 7, ItemIconGroupId: 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyUserConfig{UserId: 7, PanelJson: `{"logoText":"Before"}`, SearchEngineJson: `{}`}).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.AutoMigrate(&models.ItemIconGroup{}, &models.ItemIcon{}, &models.UserConfig{}); err != nil {
		t.Fatal(err)
	}
	for table, columns := range map[string][]string{
		"item_icon_group": {"revision", "updated_at"},
		"item_icon":       {"revision", "updated_at"},
		"user_config":     {"revision", "updated_at"},
	} {
		for _, column := range columns {
			if !db.Migrator().HasColumn(table, column) {
				t.Fatalf("migration did not add %s.%s", table, column)
			}
		}
	}

	var group models.ItemIconGroup
	if err := db.First(&group, 2).Error; err != nil {
		t.Fatal(err)
	}
	var item models.ItemIcon
	if err := db.First(&item, 3).Error; err != nil {
		t.Fatal(err)
	}
	var config models.UserConfig
	if err := db.First(&config, "user_id = ?", 7).Error; err != nil {
		t.Fatal(err)
	}
	if group.Title != "Apps" || item.Title != "Example" || config.PanelJson != `{"logoText":"Before"}` {
		t.Fatalf("migration changed existing resources: group=%+v item=%+v config=%+v", group, item, config)
	}
	if group.Revision != 0 || item.Revision != 0 || config.Revision != 0 {
		t.Fatalf("legacy resources must start at revision zero: group=%d item=%d config=%d", group.Revision, item.Revision, config.Revision)
	}
}

func TestSyncChangeTablesMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	for table, columns := range map[string][]string{
		"user_sync_state":  {"user_id", "revision", "updated_at"},
		"user_sync_change": {"id", "user_id", "revision", "resource_type", "resource_id", "operation", "payload_json", "created_at"},
	} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("migration did not create %s", table)
		}
		for _, column := range columns {
			if !db.Migrator().HasColumn(table, column) {
				t.Fatalf("migration did not add %s.%s", table, column)
			}
		}
	}
}
