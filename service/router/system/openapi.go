package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitOpenAPIRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.OpenAPIApi

	// API-05: 无参数版本/连通性接口（无需认证）
	router.GET("/v1/openapi/version", api.GetVersion)

	// API-01~04: 需要 API Token 或登录认证
	auth := router.Group("/v1/openapi", middleware.LoginInterceptor)
	{
		// 卡片
		auth.POST("/items", api.CreateItem)
		auth.GET("/items", api.GetItems)
		auth.PATCH("/items/:id", api.UpdateItem)

		// 分组
		auth.POST("/groups", api.CreateGroup)
		auth.GET("/groups", api.GetGroups)
		auth.GET("/groups/:id", api.GetGroupDetail)
	}
}
