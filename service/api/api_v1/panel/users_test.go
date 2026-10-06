package panel

import (
	"testing"

	"panel-next/global"
	"panel-next/lib/cache"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

func TestLastAdministratorCannotBeDemoted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newMutationTestDB(t)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	previousModelsDB, previousTokens := models.Db, global.UserToken
	models.Db, global.UserToken = db, cache.NewGoCache[models.User](0, 0)
	t.Cleanup(func() { models.Db, global.UserToken = previousModelsDB, previousTokens })
	admin := models.User{Username: "admin", Name: "admin", Password: "x", Status: 1, Role: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	api := UsersApi{}
	demote := map[string]any{"id": admin.ID, "username": "admin", "name": "admin", "role": 2}
	if response := callPanelMutation(t, admin.ID, demote, api.Update); response.Code != 1201 {
		t.Fatalf("last administrator was demoted: %+v", response)
	}
	invalid := map[string]any{"id": admin.ID, "username": "admin", "name": "admin", "role": 7}
	if response := callPanelMutation(t, admin.ID, invalid, api.Update); response.Code == 0 {
		t.Fatalf("unknown role was accepted: %+v", response)
	}
	second := models.User{Username: "second", Name: "second", Password: "x", Status: 1, Role: 1}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	if response := callPanelMutation(t, admin.ID, demote, api.Update); response.Code != 0 {
		t.Fatalf("demotion with another administrator failed: %+v", response)
	}
}
