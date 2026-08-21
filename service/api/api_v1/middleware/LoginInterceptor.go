package middleware

import (
	"errors"
	"strings"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

func LoginInterceptor(c *gin.Context) {
	cToken := c.GetHeader("token")
	bearerToken := bearerAccessToken(c)
	accessToken := bearerToken
	if accessToken == "" {
		accessToken = cToken
	}
	var deviceErr error
	if accessToken != "" {
		deviceErr = authenticateDeviceSession(c, accessToken)
		if deviceErr == nil {
			return
		}
	}

	legacyActive := legacyCompatibilityActive()
	if cToken != "" && legacyActive && authenticateLegacyToken(c, cToken) {
		return
	}

	switch {
	case errors.Is(deviceErr, sessionlib.ErrAccessTokenExpired):
		apiReturn.ErrorByCode(c, 1008)
	case bearerToken == "" && cToken != "" && !legacyActive:
		apiReturn.ErrorByCode(c, 1009)
	case accessToken != "":
		apiReturn.ErrorByCode(c, 1001)
	case cToken != "":
		apiReturn.ErrorByCode(c, 1001)
	default:
		apiReturn.ErrorByCode(c, 1000)
	}
	c.Abort()
}

func authenticateLegacyToken(c *gin.Context, cToken string) bool {
	token, ok := global.CUserToken.Get(cToken)
	if !ok || token == "" {
		return false
	}
	if userInfo, success := global.UserToken.Get(token); success {
		if userInfo.Status != 1 {
			return false
		}
		c.Set("userInfo", userInfo)
		c.Set(sessionlib.GinAuthModeKey, sessionlib.AuthModeLegacy)
		return true
	}
	mUser := models.User{}
	info, err := mUser.GetUserInfoByToken(token)
	if err != nil || info.Token == "" || info.ID == 0 || info.Status != 1 {
		return false
	}
	global.UserToken.SetDefault(info.Token, info)
	global.CUserToken.SetDefault(cToken, token)
	c.Set("userInfo", info)
	c.Set(sessionlib.GinAuthModeKey, sessionlib.AuthModeLegacy)
	return true
}

func authenticateDeviceSession(c *gin.Context, accessToken string) error {
	stored, err := sessionlib.NewManager(global.Db).AuthenticateAccess(c.Request.Context(), accessToken)
	if err != nil {
		return err
	}
	var info models.User
	if err := global.Db.WithContext(c.Request.Context()).First(&info, "id = ?", stored.UserID).Error; err != nil {
		return err
	}
	if info.Status != 1 {
		return sessionlib.ErrSessionRevoked
	}
	c.Set("userInfo", info)
	c.Set(sessionlib.GinSessionIDKey, stored.ID)
	c.Set(sessionlib.GinAuthModeKey, sessionlib.AuthModeDevice)
	return nil
}

func bearerAccessToken(c *gin.Context) string {
	value := strings.TrimSpace(c.GetHeader("Authorization"))
	if len(value) < 7 || !strings.EqualFold(value[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(value[7:])
}

var authenticationNow = time.Now

func legacyCompatibilityActive() bool {
	if global.Config == nil {
		return false
	}
	deadline := global.Config.GetValueStringOrDefault("session", "legacy_token_until")
	return sessionlib.LegacyTokenCompatibilityActive(deadline, authenticationNow())
}

// 不验证缓存直接验证库省去没有缓存每次都要手动登录的问题
func LoginInterceptorDev(c *gin.Context) {

	// 获得token
	token := c.GetHeader("token")
	mUser := models.User{}

	// 去库中查询是否存在该用户；否则返回错误
	if info, err := mUser.GetUserInfoByToken(token); err != nil || info.ID == 0 {
		apiReturn.ErrorCode(c, 1001, global.Lang.Get("login.err_token_expire"), nil)
		c.Abort()
		return
	} else {
		// 通过
		// 设置当前用户信息
		c.Set("userInfo", info)
	}
}
