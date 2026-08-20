package panel

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"sun-panel/global"
	"sun-panel/lib/language"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type mutationTestEnvelope struct {
	Code int `json:"code"`
	Data struct {
		Revision string          `json:"revision"`
		Result   json.RawMessage `json:"result"`
	} `json:"data"`
}

func newMutationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "mutation.db")), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserConfig{}, &models.ItemIconGroup{}, &models.ItemIcon{},
		&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	previous := global.Db
	previousLang := global.Lang
	global.Db = db
	global.Lang = language.NewLang(filepath.Join("..", "..", "..", "assets", "lang", "en-us.ini"))
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		global.Db = previous
		global.Lang = previousLang
		_ = sqlDB.Close()
	})
	return db
}

func callPanelMutation(t *testing.T, userID uint, body any, handler gin.HandlerFunc) mutationTestEnvelope {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request
	context.Set("userInfo", models.User{BaseModel: models.BaseModel{ID: userID}})
	handler(context)
	var envelope mutationTestEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
	return envelope
}

func TestUserConfigMutationRejectsStaleRevisionAndScopesAccounts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newMutationTestDB(t)
	api := UserConfig{}

	first := callPanelMutation(t, 7, map[string]any{
		"expectedRevision": "0", "data": map[string]any{"panel": map[string]any{"logoText": "First"}},
	}, api.Set)
	if first.Code != 0 || first.Data.Revision != "1" {
		t.Fatalf("unexpected first mutation response: %+v", first)
	}
	stale := callPanelMutation(t, 7, map[string]any{
		"expectedRevision": "0", "data": map[string]any{"panel": map[string]any{"logoText": "Stale"}},
	}, api.Set)
	if stale.Code != syncConflictCode {
		t.Fatalf("expected conflict response, got %+v", stale)
	}
	other := callPanelMutation(t, 8, map[string]any{
		"expectedRevision": "0", "data": map[string]any{"panel": map[string]any{"logoText": "Other"}},
	}, api.Set)
	if other.Code != 0 || other.Data.Revision != "1" {
		t.Fatalf("other account did not receive an independent revision: %+v", other)
	}

	var config models.UserConfig
	if err := db.First(&config, "user_id = ?", 7).Error; err != nil {
		t.Fatal(err)
	}
	if config.Revision != 1 || config.PanelJson != `{"logoText":"First"}` {
		t.Fatalf("stale write changed config: %+v", config)
	}
	var changes int64
	if err := db.Model(&models.UserSyncChange{}).Where("user_id = ?", 7).Count(&changes).Error; err != nil {
		t.Fatal(err)
	}
	if changes != 1 {
		t.Fatalf("stale write changed the log: %d", changes)
	}
}

func TestUserConfigMutationRejectsNonCanonicalRevision(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newMutationTestDB(t)
	api := UserConfig{}

	response := callPanelMutation(t, 7, map[string]any{
		"expectedRevision": "01", "data": map[string]any{"panel": map[string]any{"logoText": "Invalid"}},
	}, api.Set)
	if response.Code == 0 {
		t.Fatalf("non-canonical revision was accepted: %+v", response)
	}

	var configs int64
	if err := db.Model(&models.UserConfig{}).Where("user_id = ?", 7).Count(&configs).Error; err != nil {
		t.Fatal(err)
	}
	if configs != 0 {
		t.Fatalf("invalid revision created %d configs", configs)
	}
}

func TestUserConfigMutationPreservesUnprovidedSections(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newMutationTestDB(t)
	api := UserConfig{}

	first := callPanelMutation(t, 9, map[string]any{
		"expectedRevision": "0",
		"data": map[string]any{
			"panel":        map[string]any{"logoText": "Panel", "widgets": map[string]any{"schemaVersion": 1, "widgets": []any{}}},
			"searchEngine": map[string]any{"list": []any{map[string]any{"name": "Bing"}}},
		},
	}, api.Set)
	if first.Code != 0 {
		t.Fatalf("initial save failed: %+v", first)
	}

	panelOnly := callPanelMutation(t, 9, map[string]any{
		"expectedRevision": first.Data.Revision,
		"data":             map[string]any{"panel": map[string]any{"logoText": "PanelOnly"}},
	}, api.Set)
	if panelOnly.Code != 0 {
		t.Fatalf("panel-only save failed: %+v", panelOnly)
	}

	var afterPanelOnly models.UserConfig
	if err := db.First(&afterPanelOnly, "user_id = ?", 9).Error; err != nil {
		t.Fatal(err)
	}
	var engine map[string]any
	if err := json.Unmarshal([]byte(afterPanelOnly.SearchEngineJson), &engine); err != nil {
		t.Fatalf("panel-only save clobbered search engine: %q", afterPanelOnly.SearchEngineJson)
	}
	if list, ok := engine["list"].([]any); !ok || len(list) != 1 {
		t.Fatalf("panel-only save lost the stored search engine: %q", afterPanelOnly.SearchEngineJson)
	}

	engineOnly := callPanelMutation(t, 9, map[string]any{
		"expectedRevision": panelOnly.Data.Revision,
		"data":             map[string]any{"searchEngine": map[string]any{"list": []any{}}},
	}, api.Set)
	if engineOnly.Code != 0 {
		t.Fatalf("search-engine-only save failed: %+v", engineOnly)
	}

	var config models.UserConfig
	if err := db.First(&config, "user_id = ?", 9).Error; err != nil {
		t.Fatal(err)
	}
	if config.PanelJson == "" || config.PanelJson == "null" {
		t.Fatalf("search-engine-only save clobbered panel: %q", config.PanelJson)
	}
	var panel map[string]any
	if err := json.Unmarshal([]byte(config.PanelJson), &panel); err != nil {
		t.Fatalf("stored panel is not valid JSON: %q", config.PanelJson)
	}
	if panel["logoText"] != "PanelOnly" {
		t.Fatalf("unexpected stored panel: %q", config.PanelJson)
	}
}

func TestItemMutationCannotUseAnotherAccountsGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newMutationTestDB(t)
	group := models.ItemIconGroup{Title: "Private", UserId: 8}
	if err := db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	api := ItemIcon{}
	response := callPanelMutation(t, 7, map[string]any{
		"expectedRevision": "0", "data": map[string]any{
			"title": "Cross account", "url": "https://example.com", "openMethod": 1, "itemIconGroupId": group.ID,
		},
	}, api.Edit)
	if response.Code == 0 {
		t.Fatalf("cross-account item mutation succeeded: %+v", response)
	}
	var count int64
	if err := db.Model(&models.ItemIcon{}).Where("user_id = ?", 7).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("cross-account mutation created %d items", count)
	}
}
