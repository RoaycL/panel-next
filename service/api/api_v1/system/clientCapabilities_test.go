package system

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sun-panel/global"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestClientCapabilitiesAndVersionNegotiation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousNow := clientCapabilitiesNow
	clientCapabilitiesNow = func() time.Time { return time.Date(2026, 8, 9, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { clientCapabilitiesNow = previousNow })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.InstanceMetadata{}); err != nil {
		t.Fatal(err)
	}
	const instanceID = "17d34845-c0e9-45ca-9e9e-7a4a87a8e005"
	if err := db.Create(&models.InstanceMetadata{Name: models.InstanceMetadataID, Value: instanceID}).Error; err != nil {
		t.Fatal(err)
	}
	previousDB := global.Db
	global.Db = db
	t.Cleanup(func() { global.Db = previousDB })

	api := ClientCapabilitiesApi{}
	router := gin.New()
	router.GET("/api/v1/client/capabilities", api.Get)

	response := requestCapabilities(t, router, "")
	if response.Code != http.StatusOK {
		t.Fatalf("default negotiation status=%d body=%s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{
		instanceID, `"current":1`, `"selected":1`, `"methods":["device_session","legacy_token"]`,
		`"deviceSession":{"accessTokenTTLSeconds":900,"available":true,"clientTypes":["web","chrome_extension"]`, `"clientTypes":["web","chrome_extension"]`,
		`"syncBootstrap":true`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("capability response missing %q: %s", expected, body)
		}
	}
	for _, forbidden := range []string{"postgres", "sqlite", "database", "hostname"} {
		if strings.Contains(strings.ToLower(body), forbidden) {
			t.Fatalf("capability response leaked deployment detail %q: %s", forbidden, body)
		}
	}
	if response.Header().Get(APIVersionHeader) != "1" || response.Header().Get(MinimumAPIVersionHeader) != "1" {
		t.Fatalf("missing version response headers: %#v", response.Header())
	}

	response = requestCapabilities(t, router, "2")
	if response.Code != http.StatusUpgradeRequired || !strings.Contains(response.Body.String(), `"code":1401`) {
		t.Fatalf("unsupported negotiation status=%d body=%s", response.Code, response.Body.String())
	}

	response = requestCapabilities(t, router, "invalid")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":1400`) {
		t.Fatalf("invalid negotiation status=%d body=%s", response.Code, response.Body.String())
	}
}

func requestCapabilities(t *testing.T, router http.Handler, version string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/client/capabilities", nil)
	if version != "" {
		request.Header.Set(APIVersionHeader, version)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
