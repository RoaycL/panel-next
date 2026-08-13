package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sun-panel/api/api_v1/common/apiData/syncApiStructs"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestSyncBootstrapAggregatesOnlyCurrentAccount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.ItemIconGroup{}, &models.ItemIcon{}, &models.UserConfig{}, &models.UserSyncState{}); err != nil {
		t.Fatal(err)
	}
	firstGroup := models.ItemIconGroup{Title: "Second", Sort: 2, Revision: 4, UserId: 7}
	secondGroup := models.ItemIconGroup{Title: "First", Sort: 1, Revision: 6, UserId: 7}
	otherGroup := models.ItemIconGroup{Title: "Other account", Sort: 0, Revision: 99, UserId: 8}
	for _, group := range []*models.ItemIconGroup{&firstGroup, &secondGroup, &otherGroup} {
		if err := db.Create(group).Error; err != nil {
			t.Fatal(err)
		}
	}
	items := []models.ItemIcon{
		{Title: "Second item", Sort: 2, Revision: 8, UserId: 7, ItemIconGroupId: int(secondGroup.ID), IconJson: `{"itemType":1,"src":"second.svg"}`},
		{Title: "First item", Sort: 1, Revision: 9, UserId: 7, ItemIconGroupId: int(secondGroup.ID), IconJson: `{"itemType":1,"src":"first.svg"}`},
		{Title: "Private other item", Sort: 1, Revision: 100, UserId: 8, ItemIconGroupId: int(otherGroup.ID)},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	config := models.UserConfig{
		UserId: 7, Revision: 7, PanelJson: `{"logoText":"Panel Next"}`,
		SearchEngineJson: `{"default":"google"}`,
	}
	if err := db.Create(&config).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.UserSyncState{UserID: 7, Revision: 12}).Error; err != nil {
		t.Fatal(err)
	}

	previousDB, previousNow := global.Db, syncBootstrapNow
	global.Db = db
	syncBootstrapNow = func() time.Time { return time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() {
		global.Db, syncBootstrapNow = previousDB, previousNow
	})
	user := models.User{
		BaseModel: models.BaseModel{ID: 7}, Username: "sync@example.com", Password: "secret-password",
		Name: "Sync User", Status: 1, Role: 2, Token: "secret-legacy-token",
	}
	response := callSyncBootstrap(t, user, sessionlib.AuthModeDevice, "1")
	if response.Code != http.StatusOK {
		t.Fatalf("bootstrap status=%d body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		Code int                              `json:"code"`
		Data syncApiStructs.BootstrapResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	data := envelope.Data
	if envelope.Code != 0 || data.SchemaVersion != 1 || data.Revision != "12" || data.GeneratedAt.Format(time.RFC3339) != "2026-08-09T12:00:00Z" {
		t.Fatalf("unexpected bootstrap envelope: %+v", data)
	}
	if data.Account.ID != 7 || data.Account.Username != user.Username || data.Panel.Revision != "7" {
		t.Fatalf("unexpected account/config data: %+v", data)
	}
	if len(data.Panel.Groups) != 2 || data.Panel.Groups[0].Title != "First" || data.Panel.Groups[1].Title != "Second" {
		t.Fatalf("groups are missing, unscoped, or unordered: %+v", data.Panel.Groups)
	}
	if len(data.Panel.Groups[0].Items) != 2 || data.Panel.Groups[0].Items[0].Title != "First item" || data.Panel.Groups[0].Items[1].Title != "Second item" {
		t.Fatalf("items are missing, unscoped, or unordered: %+v", data.Panel.Groups[0].Items)
	}
	if data.Panel.Groups[0].Items[0].Icon.Src != "first.svg" || data.Panel.Groups[0].Items[0].Revision != "9" {
		t.Fatalf("item icon or revision was not decoded: %+v", data.Panel.Groups[0].Items[0])
	}
	body := response.Body.String()
	for _, forbidden := range []string{"secret-password", "secret-legacy-token", "Private other item", `"userId"`, `"iconJson"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("bootstrap leaked %q: %s", forbidden, body)
		}
	}
	if response.Header().Get(APIVersionHeader) != "1" || response.Header().Get(MinimumAPIVersionHeader) != "1" {
		t.Fatalf("missing version headers: %#v", response.Header())
	}
}

func TestSyncBootstrapRequiresDeviceSessionAndCreatesDefaultGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.ItemIconGroup{}, &models.ItemIcon{}, &models.UserConfig{}, &models.UserSyncState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.ItemIcon{Title: "Orphan", UserId: 10, ItemIconGroupId: 0}).Error; err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	global.Db = db
	t.Cleanup(func() { global.Db = previousDB })
	user := models.User{BaseModel: models.BaseModel{ID: 10}, Username: "empty@example.com", Status: 1}

	legacyResponse := callSyncBootstrap(t, user, sessionlib.AuthModeLegacy, "1")
	if !strings.Contains(legacyResponse.Body.String(), `"code":1001`) {
		t.Fatalf("legacy token reached bootstrap: %s", legacyResponse.Body.String())
	}
	unsupportedResponse := callSyncBootstrap(t, user, sessionlib.AuthModeDevice, "2")
	if unsupportedResponse.Code != http.StatusUpgradeRequired || !strings.Contains(unsupportedResponse.Body.String(), `"code":1401`) {
		t.Fatalf("unsupported API version reached bootstrap: status=%d body=%s", unsupportedResponse.Code, unsupportedResponse.Body.String())
	}

	response := callSyncBootstrap(t, user, sessionlib.AuthModeDevice, "1")
	var envelope struct {
		Data syncApiStructs.BootstrapResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Panel.Groups) != 1 || envelope.Data.Panel.Groups[0].Title != "APP" || len(envelope.Data.Panel.Groups[0].Items) != 1 {
		t.Fatalf("default group did not adopt orphan items: %s", response.Body.String())
	}
	var stored models.ItemIcon
	if err := db.First(&stored, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ItemIconGroupId != int(envelope.Data.Panel.Groups[0].ID) {
		t.Fatalf("orphan item was not persisted in the default group: %+v", stored)
	}
}

func callSyncBootstrap(t *testing.T, user models.User, authMode, version string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/sync/bootstrap", nil)
	request.Header.Set(APIVersionHeader, version)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userInfo", user)
	c.Set(sessionlib.GinAuthModeKey, authMode)
	api := SyncBootstrapApi{}
	api.Get(c)
	return response
}
