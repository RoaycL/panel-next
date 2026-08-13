package system

import (
	"sun-panel/api/api_v1"
	"sun-panel/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitSync(router *gin.RouterGroup) {
	bootstrapApi := api_v1.ApiGroupApp.ApiSystem.SyncBootstrapApi
	changesApi := api_v1.ApiGroupApp.ApiSystem.SyncChangesApi
	router.GET("/v1/sync/bootstrap", middleware.LoginInterceptor, bootstrapApi.Get)
	router.GET("/v1/sync/changes", middleware.LoginInterceptor, changesApi.Get)
}
