package middleware

import (
	"errors"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	"panel-next/lib/cmn/systemSetting"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

// 公开访问模式（访客模式）
// [有token将自动登录，无token/过期将使用公开账号，不可以与LoginInterceptor一起使用]
func PublicModeInterceptor(c *gin.Context) {
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
	if errors.Is(deviceErr, sessionlib.ErrAccessTokenExpired) {
		apiReturn.ErrorByCode(c, 1008)
		c.Abort()
		return
	}
	if errors.Is(deviceErr, sessionlib.ErrSessionRevoked) || (bearerToken != "" && !legacyActive) {
		apiReturn.ErrorByCode(c, 1001)
		c.Abort()
		return
	}

	// 获取公开账号的信息
	var userId *uint
	if err := global.SystemSetting.GetValueByInterface(systemSetting.PANEL_PUBLIC_USER_ID, &userId); err == nil && userId != nil {
		userInfo := models.User{}
		if err := global.Db.First(&userInfo, "id=?", userId).Error; err != nil {
			apiReturn.ErrorCode(c, 1001, global.Lang.Get("login.err_token_expire"), nil)
			c.Abort()
			return
		}
		global.Logger.Debug("使用访客用户")
		global.Logger.Debug("访客用户ID:", userInfo.ID)
		c.Set("userInfo", userInfo)
		c.Set(base.GIN_GET_VISIT_MODE, base.VISIT_MODE_PUBLIC)
		return
	} else {
		global.Logger.Debug("访客用户不存在，user_id=", userId)
		apiReturn.ErrorCode(c, 1001, global.Lang.Get("login.err_token_expire"), nil)
		c.Abort()
		return
	}

}
