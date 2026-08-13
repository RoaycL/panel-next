package cors

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

const testExtensionID = "abcdefghijklmnopabcdefghijklmnop"

func TestPolicyAllowsOnlyConfiguredOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	policy, err := NewPolicy("https://panel.example.com, http://localhost:5173/", testExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(policy.Handler())
	router.GET("/probe", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	for _, origin := range []string{"https://panel.example.com", "chrome-extension://" + testExtensionID} {
		response := corsRequest(router, http.MethodGet, origin, "", "")
		if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != origin {
			t.Fatalf("allowed origin %q: status=%d headers=%v", origin, response.Code, response.Header())
		}
		if response.Header().Get("Access-Control-Allow-Credentials") != "" {
			t.Fatal("cookie credentials must remain disabled")
		}
	}

	response := corsRequest(router, http.MethodGet, "https://evil.example", "", "")
	if response.Code != http.StatusForbidden || response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unlisted origin was allowed: status=%d headers=%v", response.Code, response.Header())
	}
	response = corsRequest(router, http.MethodGet, "", "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("same-origin/server request without Origin failed: %d", response.Code)
	}
}

func TestPolicyKeepsSameOriginWebRequestsWorking(t *testing.T) {
	gin.SetMode(gin.TestMode)
	policy, err := NewPolicy("", "")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(policy.Handler())
	router.POST("/probe", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	request := httptest.NewRequest(http.MethodPost, "http://panel.example.com/probe", nil)
	request.Header.Set("Origin", "http://panel.example.com")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("same-origin POST failed with empty cross-origin config: %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "http://panel.example.com/probe", nil)
	request.Header.Set("Origin", "https://panel.example.com")
	request.Header.Set("X-Forwarded-Proto", "https")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("proxied HTTPS same-origin POST failed: %d", response.Code)
	}
}

func TestPolicyHandlesPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	policy, err := NewPolicy("", testExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(policy.Handler())

	origin := "chrome-extension://" + testExtensionID
	response := corsRequest(router, http.MethodOptions, origin, http.MethodPost, "content-type, token, lang, x-panel-api-version")
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Max-Age") != "600" {
		t.Fatalf("valid preflight: status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	response = corsRequest(router, http.MethodOptions, origin, http.MethodPost, "x-unexpected-header")
	if response.Code != http.StatusForbidden {
		t.Fatalf("unexpected preflight header was allowed: %d", response.Code)
	}
	response = corsRequest(router, http.MethodOptions, origin, http.MethodPut, "content-type")
	if response.Code != http.StatusForbidden {
		t.Fatalf("unexpected preflight method was allowed: %d", response.Code)
	}
}

func TestPolicyRejectsUnsafeConfiguration(t *testing.T) {
	for _, origins := range []string{"*", "null", "https://example.com/path", "ftp://example.com"} {
		if _, err := NewPolicy(origins, ""); err == nil {
			t.Fatalf("unsafe origin %q was accepted", origins)
		}
	}
	if _, err := NewPolicy("", "not-an-extension-id"); err == nil {
		t.Fatal("invalid extension ID was accepted")
	}
}

func corsRequest(handler http.Handler, method, origin, requestedMethod, requestedHeaders string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/probe", nil)
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if requestedMethod != "" {
		request.Header.Set("Access-Control-Request-Method", requestedMethod)
	}
	if requestedHeaders != "" {
		request.Header.Set("Access-Control-Request-Headers", requestedHeaders)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
