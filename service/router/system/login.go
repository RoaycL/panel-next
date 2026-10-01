package system

import (
	"panel-next/api/api_v1"
	"panel-next/api/api_v1/middleware"
	"panel-next/lib/ratelimit"
	"time"

	"github.com/gin-gonic/gin"
)

func InitLogin(router *gin.RouterGroup) {
	loginApi := api_v1.ApiGroupApp.ApiSystem.LoginApi

	loginLimit := ratelimit.NewFixedWindow(20, time.Minute)
	router.POST("/login", accountRateLimit(loginLimit), loginApi.Login)
	router.POST("/v1/sessions/login", accountRateLimit(loginLimit), loginApi.SessionLogin)
	router.POST("/v1/accounts/register", accountRateLimit(ratelimit.NewFixedWindow(5, 10*time.Minute)), loginApi.Register)
	admin := router.Group("/v1/accounts", middleware.LoginInterceptor, middleware.AdminInterceptor)
	admin.GET("/settings", loginApi.AccountSettingsGet)
	admin.POST("/settings", loginApi.AccountSettingsSet)
	router.POST("/v1/sessions/refresh", loginApi.SessionRefresh)
	router.POST("/v1/sessions/upgrade", middleware.LoginInterceptor, loginApi.SessionUpgrade)
	router.POST("/logout", middleware.LoginInterceptor, loginApi.Logout)

}
