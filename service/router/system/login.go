package system

import (
	"sun-panel/api/api_v1"
	"sun-panel/api/api_v1/middleware"

	"github.com/gin-gonic/gin"
)

func InitLogin(router *gin.RouterGroup) {
	loginApi := api_v1.ApiGroupApp.ApiSystem.LoginApi

	router.POST("/login", loginApi.Login)
	router.POST("/v1/sessions/login", loginApi.SessionLogin)
	router.POST("/v1/sessions/refresh", loginApi.SessionRefresh)
	router.POST("/v1/sessions/upgrade", middleware.LoginInterceptor, loginApi.SessionUpgrade)
	router.POST("/logout", middleware.LoginInterceptor, loginApi.Logout)

}
