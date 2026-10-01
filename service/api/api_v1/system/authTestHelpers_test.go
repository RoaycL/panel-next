package system

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

// Shared request helpers exercise login, registration and profile handlers.
func callSessionHandler(t *testing.T, body any, user models.User, currentSessionID string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	return callSessionHandlerWithToken(t, body, user, currentSessionID, "", handler)
}

func callSessionHandlerWithToken(t *testing.T, body any, user models.User, currentSessionID, legacyToken string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	requestBody := bytes.NewReader(nil)
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		requestBody = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(http.MethodPost, "/", requestBody)
	request.Header.Set("Content-Type", "application/json")
	if legacyToken != "" {
		request.Header.Set("token", legacyToken)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userInfo", user)
	c.Set(sessionlib.GinAuthModeKey, sessionlib.AuthModeLegacy)
	if currentSessionID != "" {
		c.Set(sessionlib.GinSessionIDKey, currentSessionID)
	}
	handler(c)
	return response
}
