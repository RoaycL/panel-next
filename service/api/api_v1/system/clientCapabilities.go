package system

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/lib/cmn"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

const (
	CurrentAPIVersion       = 1
	MinimumAPIVersion       = 1
	APIVersionHeader        = "X-Panel-API-Version"
	MinimumAPIVersionHeader = "X-Panel-API-Min-Version"
)

type ClientCapabilitiesApi struct{}

var clientCapabilitiesNow = time.Now

func (a *ClientCapabilitiesApi) Get(c *gin.Context) {
	selected, ok := applyAPIVersionNegotiation(c)
	if !ok {
		return
	}

	var metadata models.InstanceMetadata
	if err := global.Db.WithContext(c.Request.Context()).First(&metadata, "name = ?", models.InstanceMetadataID).Error; err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
			"code": 1500,
			"msg":  "instance metadata unavailable",
		})
		return
	}
	version := cmn.GetSysVersionInfo().Version
	legacyUntil := sessionlib.DefaultLegacyTokenUntil
	if global.Config != nil {
		legacyUntil = global.Config.GetValueStringOrDefault("session", "legacy_token_until")
	}
	if effective, ok := sessionlib.EffectiveLegacyTokenDeadline(legacyUntil); ok {
		legacyUntil = effective.Format(time.RFC3339)
	} else {
		legacyUntil = ""
	}
	legacyAvailable := sessionlib.LegacyTokenCompatibilityActive(legacyUntil, clientCapabilitiesNow())
	methods := []string{"device_session"}
	if legacyAvailable {
		methods = append(methods, "legacy_token")
	}
	apiReturn.SuccessData(c, gin.H{
		"apiVersion": gin.H{
			"current": CurrentAPIVersion, "minimum": MinimumAPIVersion,
			"selected": selected, "supported": []int{CurrentAPIVersion},
		},
		"instance": gin.H{
			"id": metadata.Value, "product": "panel-next", "version": version,
		},
		"clientTypes": []string{models.SessionClientWeb, models.SessionClientChromeExtension},
		"authentication": gin.H{
			"methods": methods,
			"legacyToken": gin.H{
				"available": legacyAvailable, "until": legacyUntil,
			},
			"deviceSession": gin.H{
				"available": true, "clientTypes": []string{models.SessionClientWeb, models.SessionClientChromeExtension},
				"accessTokenTTLSeconds":  int(sessionlib.AccessTokenTTL.Seconds()),
				"refreshTokenTTLSeconds": int(sessionlib.RefreshTokenTTL.Seconds()),
				"loginEndpoint":          "/api/v1/sessions/login", "refreshEndpoint": "/api/v1/sessions/refresh",
				"legacyUpgradeEndpoint": "/api/v1/sessions/upgrade",
			},
		},
		"features": gin.H{
			"extensionServerSelection": true,
			"deviceSessionManagement":  true,
			"syncBootstrap":            true,
		},
	})
}

func applyAPIVersionNegotiation(c *gin.Context) (int, bool) {
	c.Header(APIVersionHeader, strconv.Itoa(CurrentAPIVersion))
	c.Header(MinimumAPIVersionHeader, strconv.Itoa(MinimumAPIVersion))
	c.Header("Vary", "Origin, "+APIVersionHeader)

	selected, negotiationErr := negotiateAPIVersion(c.GetHeader(APIVersionHeader))
	if negotiationErr != nil {
		c.AbortWithStatusJSON(negotiationErr.status, gin.H{
			"code": negotiationErr.code,
			"msg":  negotiationErr.message,
			"data": gin.H{
				"current": CurrentAPIVersion,
				"minimum": MinimumAPIVersion,
			},
		})
		return 0, false
	}
	return selected, true
}

type versionNegotiationError struct {
	status  int
	code    int
	message string
}

func negotiateAPIVersion(raw string) (int, *versionNegotiationError) {
	requested := strings.TrimSpace(raw)
	if requested == "" {
		return CurrentAPIVersion, nil
	}
	version, err := strconv.Atoi(requested)
	if err != nil || version <= 0 {
		return 0, &versionNegotiationError{
			status: http.StatusBadRequest, code: 1400, message: "invalid API version",
		}
	}
	if version < MinimumAPIVersion || version > CurrentAPIVersion {
		return 0, &versionNegotiationError{
			status: http.StatusUpgradeRequired, code: 1401, message: "unsupported API version",
		}
	}
	return version, nil
}
