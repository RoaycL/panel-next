package system

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"panel-next/global"
	"panel-next/lib/cache"
	"panel-next/lib/cmn"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestSessionLoginAndRefreshEndpoints(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	user := models.User{Username: "web@example.com", Password: cmn.PasswordEncryption("password-123"), Name: "Web User", Status: 1, Role: 2}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	previousGlobalDB, previousModelDB, previousClientTokens := global.Db, models.Db, global.CUserToken
	global.Db, models.Db = db, db
	global.CUserToken = cache.NewGoCache[string](time.Hour, 0)
	t.Cleanup(func() {
		global.Db, models.Db, global.CUserToken = previousGlobalDB, previousModelDB, previousClientTokens
	})

	api := LoginApi{}
	response := callSessionHandler(t, map[string]string{
		"username": user.Username, "password": "password-123", "deviceId": "browser-stable-id",
		"deviceName": "Test browser", "clientType": models.SessionClientWeb,
	}, models.User{}, "", api.SessionLogin)
	var loginResponse struct {
		Code int `json:"code"`
		Data struct {
			SessionID        string      `json:"sessionId"`
			AccessToken      string      `json:"accessToken"`
			RefreshToken     string      `json:"refreshToken"`
			AccessExpiresAt  interface{} `json:"accessExpiresAt"`
			RefreshExpiresAt interface{} `json:"refreshExpiresAt"`
			User             sessionUser `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &loginResponse); err != nil {
		t.Fatal(err)
	}
	if loginResponse.Code != 0 || loginResponse.Data.SessionID == "" || loginResponse.Data.AccessToken == "" || loginResponse.Data.RefreshToken == "" {
		t.Fatalf("session login failed: %s", response.Body.String())
	}
	if loginResponse.Data.User.ID != user.ID || strings.Contains(response.Body.String(), "password-123") || strings.Contains(response.Body.String(), "tokenHash") {
		t.Fatalf("unsafe session login response: %s", response.Body.String())
	}
	if _, err := sessionlib.NewManager(db).AuthenticateAccess(context.Background(), loginResponse.Data.AccessToken); err != nil {
		t.Fatalf("issued access token failed: %v", err)
	}

	response = callSessionHandler(t, map[string]string{"refreshToken": loginResponse.Data.RefreshToken}, models.User{}, "", api.SessionRefresh)
	var refreshResponse struct {
		Code int             `json:"code"`
		Data sessionlib.Pair `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &refreshResponse); err != nil {
		t.Fatal(err)
	}
	if refreshResponse.Code != 0 || refreshResponse.Data.AccessToken == "" || refreshResponse.Data.RefreshToken == loginResponse.Data.RefreshToken {
		t.Fatalf("session refresh failed: %s", response.Body.String())
	}
	if _, err := sessionlib.NewManager(db).AuthenticateAccess(context.Background(), loginResponse.Data.AccessToken); err == nil {
		t.Fatal("old access token survived refresh rotation")
	}
	if _, err := sessionlib.NewManager(db).AuthenticateAccess(context.Background(), refreshResponse.Data.AccessToken); err != nil {
		t.Fatalf("rotated access token failed: %v", err)
	}

	const legacyClientToken = "legacy-extension-client-token"
	global.CUserToken.SetDefault(legacyClientToken, "legacy-database-token")
	response = callSessionHandlerWithToken(t, map[string]string{
		"deviceId": "extension-stable-id", "deviceName": "Chrome Extension", "clientType": models.SessionClientChromeExtension,
	}, user, "", legacyClientToken, api.SessionUpgrade)
	var upgradeResponse struct {
		Code int `json:"code"`
		Data struct {
			SessionID   string `json:"sessionId"`
			AccessToken string `json:"accessToken"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &upgradeResponse); err != nil {
		t.Fatal(err)
	}
	if upgradeResponse.Code != 0 || upgradeResponse.Data.SessionID == "" || upgradeResponse.Data.AccessToken == "" {
		t.Fatalf("legacy extension upgrade failed: %s", response.Body.String())
	}
	var extensionSession models.UserSession
	if err := db.First(&extensionSession, "id = ?", upgradeResponse.Data.SessionID).Error; err != nil {
		t.Fatal(err)
	}
	if extensionSession.UserID != user.ID || extensionSession.ClientType != models.SessionClientChromeExtension {
		t.Fatalf("unexpected upgraded extension session: %+v", extensionSession)
	}
	if _, exists := global.CUserToken.Get(legacyClientToken); exists {
		t.Fatal("legacy client token remained valid after extension upgrade")
	}

}
