package system

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestUploadBodyLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	reached := false
	router.POST("/upload", limitRequestBody(8), func(c *gin.Context) { reached = true })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("more than eight bytes")))
	if reached || !strings.Contains(response.Body.String(), "上传内容过大") {
		t.Fatalf("oversized upload reached the handler: %s", response.Body.String())
	}
}
