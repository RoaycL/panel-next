package system

import (
	"panel-next/api/api_v1/imgbed"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitImgbedRouter(router *gin.RouterGroup) {
	api := imgbed.ImgbedApi{}
	admin := router.Group("", middleware.LoginInterceptor, middleware.AdminInterceptor)
	admin.GET("/imgbed/config", api.GetConfig)
	admin.POST("/imgbed/config", api.SetConfig)
	admin.POST("/imgbed/test", api.TestConfig)

	upload := router.Group("", middleware.LoginInterceptor)
	upload.POST("/imgbed/upload", api.Upload)
}
