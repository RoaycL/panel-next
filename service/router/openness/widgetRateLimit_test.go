package openness

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"panel-next/lib/ratelimit"

	"github.com/gin-gonic/gin"
)

func TestWidgetRateLimitBlocksOverLimitRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := ratelimit.NewFixedWindow(2, time.Minute)
	router := gin.New()
	router.GET("/v1/widgets/weather", WidgetRateLimit(limiter), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"code": 0})
	})

	for call := 1; call <= 2; call++ {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/widgets/weather", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("call %d within limit returned %d", call, response.Code)
		}
		var envelope struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Code != 0 {
			t.Fatalf("call %d within limit returned code %d", call, envelope.Code)
		}
	}

	blocked := httptest.NewRecorder()
	router.ServeHTTP(blocked, httptest.NewRequest(http.MethodGet, "/v1/widgets/weather", nil))
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(blocked.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 1600 {
		t.Fatalf("expected rate limit code 1600, got %d (body %q)", envelope.Code, blocked.Body.String())
	}
	if retryAfter := blocked.Header().Get("Retry-After"); retryAfter == "" {
		t.Fatal("expected Retry-After header on rate limited response")
	}
}

func TestWidgetRateLimitKeysByClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := ratelimit.NewFixedWindow(1, time.Minute)
	router := gin.New()
	router.GET("/v1/widgets/trending", WidgetRateLimit(limiter), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"code": 0})
	})

	first := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/widgets/trending", nil)
	request.RemoteAddr = "10.0.0.1:1234"
	router.ServeHTTP(first, request)
	if first.Code != http.StatusOK {
		t.Fatalf("first client request returned %d", first.Code)
	}

	// 同一 IP 第二次被限流
	blocked := httptest.NewRecorder()
	blockedRequest := httptest.NewRequest(http.MethodGet, "/v1/widgets/trending", nil)
	blockedRequest.RemoteAddr = "10.0.0.1:1234"
	router.ServeHTTP(blocked, blockedRequest)
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(blocked.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 1600 {
		t.Fatalf("expected repeat request to be limited, got %d", envelope.Code)
	}

	// 不同 IP 不受影响
	other := httptest.NewRecorder()
	otherRequest := httptest.NewRequest(http.MethodGet, "/v1/widgets/trending", nil)
	otherRequest.RemoteAddr = "10.0.0.2:1234"
	router.ServeHTTP(other, otherRequest)
	if other.Code != http.StatusOK {
		t.Fatalf("unrelated client was limited with %d", other.Code)
	}
}
