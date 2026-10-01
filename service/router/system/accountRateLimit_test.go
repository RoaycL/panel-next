package system

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"panel-next/lib/ratelimit"
)

func TestAccountLimitCannotBeBypassedWithForwardedHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/register", accountRateLimit(ratelimit.NewFixedWindow(1, time.Minute)), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"code": 0}) })
	for i, forwarded := range []string{"198.51.100.1", "198.51.100.2"} {
		request := httptest.NewRequest(http.MethodPost, "/register", nil)
		request.RemoteAddr = "192.0.2.10:12345"
		request.Header.Set("X-Forwarded-For", forwarded)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if i == 0 && response.Header().Get("Retry-After") != "" {
			t.Fatal("first request blocked")
		}
		if i == 1 && response.Header().Get("Retry-After") == "" {
			t.Fatal("spoofed forwarded header bypassed limit")
		}
	}
}
