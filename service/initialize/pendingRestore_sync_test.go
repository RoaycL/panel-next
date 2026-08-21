package initialize

import (
	"testing"

	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestRebuildSyncStateAfterBusinessRestore(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{}, &models.UserConfig{}, &models.ItemIconGroup{}, &models.ItemIcon{},
		&models.UserSyncState{}, &models.UserSyncChange{},
	); err != nil {
		t.Fatal(err)
	}
	users := []models.User{
		{BaseModel: models.BaseModel{ID: 7}, Username: "first@example.com"},
		{BaseModel: models.BaseModel{ID: 8}, Username: "second@example.com"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.UserConfig{UserId: 7, Revision: 4}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.ItemIconGroup{UserId: 7, Revision: 9}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.ItemIcon{UserId: 7, Revision: 6}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.UserSyncState{UserID: 7, Revision: 99}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.UserSyncChange{
		UserID: 7, Revision: 99, ResourceType: models.SyncResourcePanel,
		ResourceID: "7", Operation: models.SyncOperationUpsert, PayloadJSON: `{}`,
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Transaction(rebuildSyncStateAfterBusinessRestore); err != nil {
		t.Fatal(err)
	}
	var states []models.UserSyncState
	if err := db.Order("user_id").Find(&states).Error; err != nil {
		t.Fatal(err)
	}
	if len(states) != 2 || states[0].UserID != 7 || states[0].Revision != 9 || states[1].UserID != 8 || states[1].Revision != 0 {
		t.Fatalf("unexpected rebuilt states: %+v", states)
	}
	var changes int64
	if err := db.Model(&models.UserSyncChange{}).Count(&changes).Error; err != nil {
		t.Fatal(err)
	}
	if changes != 0 {
		t.Fatalf("stale sync changes survived restore: %d", changes)
	}
}
