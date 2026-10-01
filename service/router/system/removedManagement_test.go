package system

import (
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRemovedManagementRoutesAreNotRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	Init(router.Group("/api"))
	for _, route := range router.Routes() {
		if strings.HasPrefix(route.Path, "/api/docker/") || strings.HasPrefix(route.Path, "/api/user/session/") {
			t.Fatalf("retired management route remains registered: %s %s", route.Method, route.Path)
		}
	}
	for _, required := range []string{"/api/v1/sessions/login", "/api/v1/sessions/refresh", "/api/user/updateInfo", "/api/user/updatePassword", "/api/logout"} {
		found := false
		for _, route := range router.Routes() {
			if route.Path == required {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("account functionality must remain registered: %s", required)
		}
	}
}
