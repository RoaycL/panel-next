package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitPublicFileRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.PublicFileApi

	admin := router.Group("", middleware.LoginInterceptor, middleware.AdminInterceptor)
	{
		admin.POST("/publicFile/upload", api.Upload)
		admin.POST("/publicFile/deletes", api.Deletes)
		admin.POST("/publicFile/updateType", api.UpdateType)
	}

	// 所有登录用户可读
	public := router.Group("", middleware.LoginInterceptor)
	{
		public.GET("/publicFile/getList", api.GetList)
	}
}
