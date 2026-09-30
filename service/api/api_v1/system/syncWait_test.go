package system

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"panel-next/global"
	sessionlib "panel-next/lib/session"
	"panel-next/lib/syncstate"
	"panel-next/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSyncWaitNotifiesOnlyAccountChanges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "wait.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	previousDB, previousTimeout, previousInterval := global.Db, syncWaitTimeout, syncWaitPollInterval
	global.Db, syncWaitTimeout, syncWaitPollInterval = db, 300*time.Millisecond, 5*time.Millisecond
	t.Cleanup(func() {
		global.Db, syncWaitTimeout, syncWaitPollInterval = previousDB, previousTimeout, previousInterval
	})
	user := models.User{BaseModel: models.BaseModel{ID: 11}}
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- callSyncWait(user, sessionlib.AuthModeDevice, "0") }()
	manager := syncstate.NewManager(db)
	if _, err := manager.Append(context.Background(), syncstate.AppendRequest{
		UserID: 12, ResourceType: models.SyncResourceItem, ResourceID: "1", Operation: models.SyncOperationDelete,
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-result:
		t.Fatal("another account woke the waiting client")
	case <-time.After(30 * time.Millisecond):
	}
	if _, err := manager.Append(context.Background(), syncstate.AppendRequest{
		UserID: 11, ResourceType: models.SyncResourceItem, ResourceID: "1", Operation: models.SyncOperationDelete,
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-result:
		var envelope struct {
			Code int `json:"code"`
			Data struct {
				Revision string `json:"revision"`
				Changed  bool   `json:"changed"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Code != 0 || !envelope.Data.Changed || envelope.Data.Revision != "1" {
			t.Fatalf("unexpected wait response: %s", response.Body.String())
		}
	case <-time.After(time.Second):
		t.Fatal("waiting client did not wake")
	}
	if response := callSyncWait(user, sessionlib.AuthModeLegacy, "0"); response.Code != http.StatusOK || !containsCode(response.Body.Bytes(), 1001) {
		t.Fatalf("legacy auth reached wait endpoint: %s", response.Body.String())
	}
	if response := callSyncWait(user, sessionlib.AuthModeDevice, "01"); !containsCode(response.Body.Bytes(), 1400) {
		t.Fatalf("malformed cursor accepted: %s", response.Body.String())
	}
}

func containsCode(body []byte, wanted int) bool {
	var envelope struct {
		Code int `json:"code"`
	}
	return json.Unmarshal(body, &envelope) == nil && envelope.Code == wanted
}

func callSyncWait(user models.User, mode, since string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/sync/wait?since="+since, nil)
	request.Header.Set(APIVersionHeader, "1")
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userInfo", user)
	c.Set(sessionlib.GinAuthModeKey, mode)
	(&SyncWaitApi{}).Get(c)
	return response
}
