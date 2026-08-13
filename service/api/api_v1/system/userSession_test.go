package system

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUserSessionHandlersKeepUserBoundaryAndHideHashes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	global.Db = db
	t.Cleanup(func() { global.Db = previousDB })

	manager := sessionlib.NewManager(db)
	first, firstPair, err := manager.Create(context.Background(), sessionlib.CreateRequest{
		UserID: 11, DeviceID: "web", DeviceName: "Laptop", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, secondPair, err := manager.Create(context.Background(), sessionlib.CreateRequest{
		UserID: 11, DeviceID: "extension", DeviceName: "Chrome", ClientType: models.SessionClientChromeExtension,
	})
	if err != nil {
		t.Fatal(err)
	}
	other, otherPair, err := manager.Create(context.Background(), sessionlib.CreateRequest{
		UserID: 12, DeviceID: "web", DeviceName: "Other", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}

	api := UserSessionApi{}
	response := callSessionHandler(t, nil, models.User{BaseModel: models.BaseModel{ID: 11}}, second.ID, api.GetList)
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(body, first.ID) || !strings.Contains(body, second.ID) || !strings.Contains(body, `"current":true`) {
		t.Fatalf("unexpected list response: %s", body)
	}
	if strings.Contains(body, first.AccessTokenHash) || strings.Contains(body, first.RefreshTokenHash) || strings.Contains(body, "TokenHash") {
		t.Fatalf("list response exposed credential material: %s", body)
	}

	response = callSessionHandler(t, map[string]string{"sessionId": other.ID}, models.User{BaseModel: models.BaseModel{ID: 11}}, "", api.Revoke)
	if !strings.Contains(response.Body.String(), `"code":-1`) {
		t.Fatalf("cross-user revoke was not hidden: %s", response.Body.String())
	}
	if _, err := manager.AuthenticateAccess(context.Background(), otherPair.AccessToken); err != nil {
		t.Fatalf("cross-user session was changed: %v", err)
	}

	response = callSessionHandler(t, map[string]string{"sessionId": first.ID}, models.User{BaseModel: models.BaseModel{ID: 11}}, "", api.Revoke)
	if !strings.Contains(response.Body.String(), `"code":0`) {
		t.Fatalf("own-device revoke failed: %s", response.Body.String())
	}
	if _, err := manager.AuthenticateAccess(context.Background(), firstPair.AccessToken); !errors.Is(err, sessionlib.ErrSessionRevoked) {
		t.Fatalf("own device remained active: %v", err)
	}

	response = callSessionHandler(t, nil, models.User{BaseModel: models.BaseModel{ID: 11}}, "", api.RevokeAll)
	if !strings.Contains(response.Body.String(), `"revokedCount":1`) {
		t.Fatalf("revoke-all response: %s", response.Body.String())
	}
	if _, err := manager.AuthenticateAccess(context.Background(), secondPair.AccessToken); !errors.Is(err, sessionlib.ErrSessionRevoked) {
		t.Fatalf("second own device remained active: %v", err)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), otherPair.AccessToken); err != nil {
		t.Fatalf("revoke all crossed user boundary: %v", err)
	}
}

func callSessionHandler(t *testing.T, body any, user models.User, currentSessionID string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	return callSessionHandlerWithToken(t, body, user, currentSessionID, "", handler)
}

func callSessionHandlerWithToken(t *testing.T, body any, user models.User, currentSessionID, legacyToken string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	requestBody := bytes.NewReader(nil)
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		requestBody = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(http.MethodPost, "/", requestBody)
	request.Header.Set("Content-Type", "application/json")
	if legacyToken != "" {
		request.Header.Set("token", legacyToken)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userInfo", user)
	c.Set(sessionlib.GinAuthModeKey, sessionlib.AuthModeLegacy)
	if currentSessionID != "" {
		c.Set(sessionlib.GinSessionIDKey, currentSessionID)
	}
	handler(c)
	return response
}
