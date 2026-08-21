package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitSiteSettingRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.SiteSettingApi
	admin := router.Group("", middleware.LoginInterceptor, middleware.AdminInterceptor)
	admin.GET("/siteSetting/get", api.Get)
	admin.POST("/siteSetting/set", api.Set)
}
