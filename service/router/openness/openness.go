package openness

import (
	"panel-next/api/api_v1"

	"github.com/gin-gonic/gin"
)

func InitOpenness(router *gin.RouterGroup) {
	api := api_v1.ApiGroupApp.ApiOpen.Openness
	{
		router.GET("loginConfig", api.LoginConfig)
		router.GET("getDisclaimer", api.GetDisclaimer)
		router.GET("getAboutDescription", api.GetAboutDescription)
		router.GET("siteInfo", api.GetSiteInfo)
		widgets := router.Group("v1/widgets", WidgetRateLimit(DefaultWidgetLimiter))
		{
			widgets.GET("weather", api.Weather)
			widgets.GET("trending", api.Trending)
		}
	}
}
