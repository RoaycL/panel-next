package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"panel-next/global"
	"panel-next/lib/cmn"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestDefaultPasswordOnlyAllowsPasswordChange(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{NamingStrategy: schema.NamingStrategy{SingularTable: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	hash, err := cmn.HashPassword(cmn.DefaultAdminPassword)
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{Username: "admin", Name: "admin", Password: hash, Status: 1, Role: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	_, pair, err := sessionlib.NewManager(db).Create(context.Background(), sessionlib.CreateRequest{
		UserID: user.ID, DeviceID: "default-password", DeviceName: "Browser", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousConfig := global.Db, global.Config
	global.Db, global.Config = db, nil
	t.Cleanup(func() { global.Db, global.Config = previousDB, previousConfig })

	router := gin.New()
	ok := func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"code": 0}) }
	router.GET("/api/v1/sync/bootstrap", LoginInterceptor, ok)
	router.GET("/api/user/updatePassword", LoginInterceptor, ok)

	request := func(path string) string {
		response := protectedRequestPath(router, path, pair.AccessToken)
		return response.Body.String()
	}
	if body := request("/api/v1/sync/bootstrap"); !strings.Contains(body, `"code":1010`) {
		t.Fatalf("default password reached a normal route: %s", body)
	}
	if body := request("/api/user/updatePassword"); !strings.Contains(body, `"code":0`) {
		t.Fatalf("default password could not reach the password change route: %s", body)
	}

	changed, err := cmn.HashPassword("a-new-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.User{}).Where("id = ?", user.ID).Update("password", changed).Error; err != nil {
		t.Fatal(err)
	}
	if body := request("/api/v1/sync/bootstrap"); !strings.Contains(body, `"code":0`) {
		t.Fatalf("changed password is still restricted: %s", body)
	}
}

func protectedRequestPath(handler http.Handler, path, accessToken string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
