package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitFileRouter(router *gin.RouterGroup) {
	FileApi := api_v1.ApiGroupApp.ApiSystem.FileApi

	// 验证项目的权限(有访问密码的需要验证访问token)
	private := router.Group("", middleware.LoginInterceptor)
	{
		private.POST("/file/uploadImg", limitRequestBody(maxImageUploadBytes), FileApi.UploadImg)
		private.POST("/file/uploadFiles", limitRequestBody(maxBatchUploadBytes), FileApi.UploadFiles)

		private.POST("/file/getList", FileApi.GetList)
		private.POST("/file/deletes", FileApi.Deletes)
		private.POST("/file/updateType", FileApi.UpdateType)
		private.POST("/file/deleteInvalid", FileApi.DeleteInvalid)

	}

}
