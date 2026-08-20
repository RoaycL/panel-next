package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sun-panel/global"
	"sun-panel/lib/cache"
	"sun-panel/lib/cmn/systemSetting"
	"sun-panel/lib/language"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSiteSettingTestContext(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	previousModelsDB := models.Db
	previousSetting := global.SystemSetting
	previousLang := global.Lang
	global.Db = db
	models.Db = db
	global.Lang = language.NewLang(filepath.Join("..", "..", "..", "assets", "lang", "en-us.ini"))
	global.SystemSetting = &systemSetting.SystemSettingCache{
		Cache: cache.NewGoCache[interface{}](5*time.Hour, -1),
	}
	t.Cleanup(func() {
		global.Db = previousDB
		models.Db = previousModelsDB
		global.SystemSetting = previousSetting
		global.Lang = previousLang
	})
	api := SiteSettingApi{}
	request := httptest.NewRequest(http.MethodPost, "/api/siteSetting/set", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request
	api.Set(context)
	return response
}

func decodeSiteSettingBody(t *testing.T, response *httptest.ResponseRecorder) (int, siteBranding) {
	t.Helper()
	var envelope struct {
		Code int          `json:"code"`
		Data siteBranding `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
	return envelope.Code, envelope.Data
}

func TestSiteSettingSetStoresBranding(t *testing.T) {
	response := newSiteSettingTestContext(t, `{
		"siteTitle": "  我的导航  ",
		"siteFavicon": "/uploads/2026/8/20/icon.ico",
		"loginBackground": "/uploads/2026/8/20/bg.webp"
	}`)
	code, data := decodeSiteSettingBody(t, response)
	if code != 0 {
		t.Fatalf("set failed: %s", response.Body.String())
	}
	if data.SiteTitle != "我的导航" {
		t.Fatalf("title was not trimmed: %q", data.SiteTitle)
	}
	if data.SiteFavicon != "/uploads/2026/8/20/icon.ico" || data.LoginBackground != "/uploads/2026/8/20/bg.webp" {
		t.Fatalf("unexpected branding: %+v", data)
	}
}

func TestSiteSettingSetRejectsInvalidValues(t *testing.T) {
	cases := []string{
		`{"siteFavicon": "https://evil.example.com/icon.ico"}`,
		`{"siteFavicon": "//evil.example.com/icon.ico"}`,
		`{"siteFavicon": "/a?b=c"}`,
		`{"siteFavicon": "/a#b"}`,
		`{"siteFavicon": "/a/../b"}`,
		`{"siteFavicon": "\\a"}`,
		`{"loginBackground": "javascript:alert(1)"}`,
		`{"siteTitle": "` + strings.Repeat("长", 81) + `"}`,
	}
	for _, body := range cases {
		response := newSiteSettingTestContext(t, body)
		code, _ := decodeSiteSettingBody(t, response)
		if code == 0 {
			t.Fatalf("invalid body was accepted: %s", body)
		}
	}
}

func TestSiteSettingSetAllowsEmptyValues(t *testing.T) {
	response := newSiteSettingTestContext(t, `{"siteTitle":"","siteFavicon":"","loginBackground":""}`)
	code, _ := decodeSiteSettingBody(t, response)
	if code != 0 {
		t.Fatalf("empty branding was rejected: %s", response.Body.String())
	}
}
