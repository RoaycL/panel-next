package system

import (
	"sun-panel/api/api_v1"
	"sun-panel/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitUserRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.UserApi
	sessionApi := api_v1.ApiGroupApp.ApiSystem.UserSessionApi
	r := router.Group("", middleware.LoginInterceptor)
	r.POST("/user/getInfo", api.GetInfo)
	r.POST("/user/updatePassword", api.UpdatePasssword)
	r.POST("/user/updateInfo", api.UpdateInfo)
	r.POST("/user/getReferralCode", api.GetReferralCode)
	r.POST("/user/session/getList", sessionApi.GetList)
	r.POST("/user/session/revoke", sessionApi.Revoke)
	r.POST("/user/session/revokeAll", sessionApi.RevokeAll)

	// 公开模式
	rPublic := router.Group("", middleware.PublicModeInterceptor)
	{
		rPublic.POST("/user/getAuthInfo", api.GetAuthInfo)
	}
}
