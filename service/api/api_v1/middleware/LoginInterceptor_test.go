package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"panel-next/global"
	"panel-next/lib/cache"
	"panel-next/lib/iniConfig"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
	"gopkg.in/ini.v1"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestLoginInterceptorAuthenticatesDeviceSessionAndSignalsExpiry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	user := models.User{Username: "middleware@example.com", Name: "Middleware", Status: 1, Role: 2}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	stored, pair, err := sessionlib.NewManager(db).Create(context.Background(), sessionlib.CreateRequest{
		UserID: user.ID, DeviceID: "middleware-browser", DeviceName: "Browser", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousConfig := global.Db, global.Config
	global.Db, global.Config = db, nil
	t.Cleanup(func() { global.Db, global.Config = previousDB, previousConfig })

	router := gin.New()
	router.Use(LoginInterceptor)
	router.GET("/protected", func(c *gin.Context) {
		sessionID, _ := c.Get(sessionlib.GinSessionIDKey)
		c.JSON(http.StatusOK, gin.H{"sessionId": sessionID})
	})

	response := protectedRequest(router, pair.AccessToken, "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), stored.ID) {
		t.Fatalf("valid access token was rejected: status=%d body=%s", response.Code, response.Body.String())
	}
	if err := db.Model(&models.UserSession{}).Where("id = ?", stored.ID).Update("access_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	response = protectedRequest(router, pair.AccessToken, "")
	if !strings.Contains(response.Body.String(), `"code":1008`) {
		t.Fatalf("expired access token did not request refresh: %s", response.Body.String())
	}
	response = protectedRequest(router, "", "legacy-token")
	if !strings.Contains(response.Body.String(), `"code":1009`) {
		t.Fatalf("legacy compatibility did not fail closed without configuration: %s", response.Body.String())
	}
}

func TestLoginInterceptorLegacyCompatibilityWindow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousNow := authenticationNow
	authenticationNow = func() time.Time { return time.Date(2026, 8, 9, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { authenticationNow = previousNow })
	config := &iniConfig.IniConfig{
		Config: ini.Empty(),
		Default: map[string]map[string]string{
			"session": {"legacy_token_until": "2099-01-01T00:00:00Z"},
		},
	}
	userCache := cache.NewGoCache[models.User](time.Hour, 0)
	clientTokenCache := cache.NewGoCache[string](time.Hour, 0)
	user := models.User{BaseModel: models.BaseModel{ID: 77}, Username: "legacy@example.com", Status: 1}
	userCache.SetDefault("database-token", user)
	clientTokenCache.SetDefault("legacy-client-token", "database-token")

	previousConfig, previousUserCache, previousClientCache := global.Config, global.UserToken, global.CUserToken
	global.Config, global.UserToken, global.CUserToken = config, userCache, clientTokenCache
	t.Cleanup(func() {
		global.Config, global.UserToken, global.CUserToken = previousConfig, previousUserCache, previousClientCache
	})

	router := gin.New()
	router.Use(LoginInterceptor)
	router.GET("/protected", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	response := protectedRequest(router, "", "legacy-client-token")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"ok":true`) {
		t.Fatalf("legacy token was rejected before cutoff: %s", response.Body.String())
	}

	config.Default["session"]["legacy_token_until"] = "2000-01-01T00:00:00Z"
	response = protectedRequest(router, "", "legacy-client-token")
	if !strings.Contains(response.Body.String(), `"code":1009`) {
		t.Fatalf("legacy token survived cutoff: %s", response.Body.String())
	}
}

func protectedRequest(handler http.Handler, accessToken, legacyToken string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if legacyToken != "" {
		request.Header.Set("token", legacyToken)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
