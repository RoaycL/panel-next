package system

import (
	"strings"
	"testing"

	"panel-next/global"
	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestOpenAPIItemsStayInOwnGroupsAndReachSync(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/openapi.db"), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.ItemIcon{}, &models.ItemIconGroup{}, &models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	global.Db = db
	t.Cleanup(func() { global.Db = previousDB })
	owner, other := models.User{}, models.User{}
	owner.ID, other.ID = 1, 2
	ownGroup := models.ItemIconGroup{Title: "Own", UserId: owner.ID}
	otherGroup := models.ItemIconGroup{Title: "Other", UserId: other.ID}
	if err := db.Create(&ownGroup).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&otherGroup).Error; err != nil {
		t.Fatal(err)
	}
	api := OpenAPIApi{}

	response := callSessionHandler(t, map[string]any{"title": "x", "url": "https://example.com", "itemIconGroupId": otherGroup.ID}, owner, "", api.CreateItem)
	var created int64
	db.Model(&models.ItemIcon{}).Count(&created)
	if strings.Contains(response.Body.String(), `"code":0`) || created != 0 {
		t.Fatalf("item was created in another account's group: %s", response.Body.String())
	}
	response = callSessionHandler(t, map[string]any{"title": "x", "url": "https://example.com", "itemIconGroupId": ownGroup.ID}, owner, "", api.CreateItem)
	if !strings.Contains(response.Body.String(), `"code":0`) {
		t.Fatalf("item in own group was rejected: %s", response.Body.String())
	}
	var changes int64
	db.Model(&models.UserSyncChange{}).Where("user_id = ? AND resource_type = ?", owner.ID, models.SyncResourceItem).Count(&changes)
	if changes != 1 {
		t.Fatalf("OpenAPI item write is missing from the sync log: %d changes", changes)
	}
	var item models.ItemIcon
	if err := db.First(&item).Error; err != nil || item.Revision == 0 {
		t.Fatalf("item revision not set: %v %d", err, item.Revision)
	}
}
