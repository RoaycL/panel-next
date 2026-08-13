package system

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sun-panel/api/api_v1/common/apiData/syncApiStructs"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/lib/syncstate"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestSyncChangesReturnsAccountScopedPage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/changes.db"), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	manager := syncstate.NewManager(db)
	for _, request := range []syncstate.AppendRequest{
		{UserID: 7, ResourceType: models.SyncResourceGroup, ResourceID: "11", Operation: models.SyncOperationUpsert, Payload: map[string]any{"title": "Apps"}},
		{UserID: 7, ResourceType: models.SyncResourceItem, ResourceID: "12", Operation: models.SyncOperationDelete},
		{UserID: 8, ResourceType: models.SyncResourcePanel, ResourceID: "8", Operation: models.SyncOperationUpsert, Payload: map[string]any{"private": true}},
	} {
		if _, err := manager.Append(context.Background(), request); err != nil {
			t.Fatal(err)
		}
	}
	previousDB := global.Db
	global.Db = db
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		global.Db = previousDB
		_ = sqlDB.Close()
	})

	response := callSyncChanges(t, models.User{BaseModel: models.BaseModel{ID: 7}}, sessionlib.AuthModeDevice, "0", "1")
	if response.Code != http.StatusOK {
		t.Fatalf("changes status=%d body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		Code int                            `json:"code"`
		Data syncApiStructs.ChangesResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	data := envelope.Data
	if envelope.Code != 0 || data.SchemaVersion != 1 || data.FromRevision != "0" || data.NextRevision != "1" || data.CurrentRevision != "2" || !data.HasMore || len(data.Changes) != 1 {
		t.Fatalf("unexpected changes page: %+v", data)
	}
	if data.Changes[0].ResourceID != "11" || string(data.Changes[0].Data) != `{"title":"Apps"}` || data.Changes[0].ChangedAt == "" {
		t.Fatalf("unexpected change: %+v", data.Changes[0])
	}
	if strings.Contains(response.Body.String(), "private") {
		t.Fatalf("changes leaked another account: %s", response.Body.String())
	}
	if response.Header().Get(APIVersionHeader) != "1" {
		t.Fatalf("missing version header: %#v", response.Header())
	}
}

func TestSyncChangesValidatesSessionCursorAndLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	global.Db = db
	t.Cleanup(func() { global.Db = previousDB })
	user := models.User{BaseModel: models.BaseModel{ID: 7}}

	for name, response := range map[string]*httptest.ResponseRecorder{
		"legacy":        callSyncChanges(t, user, sessionlib.AuthModeLegacy, "0", ""),
		"missing since": callSyncChanges(t, user, sessionlib.AuthModeDevice, "", ""),
		"leading zero":  callSyncChanges(t, user, sessionlib.AuthModeDevice, "01", ""),
		"limit":         callSyncChanges(t, user, sessionlib.AuthModeDevice, "0", "501"),
	} {
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"code":`) || strings.Contains(response.Body.String(), `"code":0`) {
			t.Fatalf("%s unexpectedly succeeded: status=%d body=%s", name, response.Code, response.Body.String())
		}
	}
	ahead := callSyncChanges(t, user, sessionlib.AuthModeDevice, "1", "")
	if !strings.Contains(ahead.Body.String(), `"code":1501`) || !strings.Contains(ahead.Body.String(), `"fullBootstrapRequired":true`) {
		t.Fatalf("revision-ahead fallback missing: %s", ahead.Body.String())
	}
}

func callSyncChanges(t *testing.T, user models.User, authMode, since, limit string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/sync/changes?since="+since+"&limit="+limit, nil)
	request.Header.Set(APIVersionHeader, "1")
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userInfo", user)
	c.Set(sessionlib.GinAuthModeKey, authMode)
	api := SyncChangesApi{}
	api.Get(c)
	return response
}
