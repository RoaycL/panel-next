package system

import (
	"panel-next/api/api_v1"

	"github.com/gin-gonic/gin"
)

func InitClientCapabilities(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiSystem.ClientCapabilitiesApi
	router.GET("/v1/client/capabilities", api.Get)
}
