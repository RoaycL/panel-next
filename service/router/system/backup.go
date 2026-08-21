package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitBackupRouter(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.BackupApi
	admin := router.Group("", middleware.LoginInterceptor, middleware.AdminInterceptor)
	admin.GET("/system/backup/export", api.Export)
	admin.POST("/system/backup/restore", api.Restore)
}
