package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitDockerRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.DockerApi

	// 所有登录用户可读
	public := router.Group("", middleware.LoginInterceptor)
	{
		public.GET("/docker/status", api.GetStatus)
		public.GET("/docker/getList", api.GetList)
	}

	// 管理员专用
	admin := router.Group("", middleware.LoginInterceptor, middleware.AdminInterceptor)
	{
		admin.POST("/docker/start", api.StartContainer)
		admin.POST("/docker/stop", api.StopContainer)
		admin.POST("/docker/restart", api.RestartContainer)
	}
}
