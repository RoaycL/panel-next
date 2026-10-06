package router

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestUploadedFilesCannotRunScript(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/x.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Group("/uploads", uploadedFileHeaders).Static("/", dir)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/uploads/x.svg", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("upload not served: %d", response.Code)
	}
	if policy := response.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "sandbox") || !strings.Contains(policy, "default-src 'none'") {
		t.Fatalf("uploaded SVG served without a script-blocking policy: %q", policy)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("uploads must not be content-sniffed")
	}
}
