package openness

import (
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/lib/cmn/systemSetting"

	"github.com/gin-gonic/gin"
)

type Openness struct {
}

func (a *Openness) LoginConfig(c *gin.Context) {
	cfg := systemSetting.ApplicationSetting{}
	if err := global.SystemSetting.GetValueByInterface(systemSetting.SYSTEM_APPLICATION, &cfg); err != nil {
		apiReturn.Error(c, "配置查询失败："+err.Error())
		return
	}
	apiReturn.SuccessData(c, gin.H{
		"loginCaptcha": cfg.LoginCaptcha,
		"register":     cfg.Register,
	})
}

func (a *Openness) GetDisclaimer(c *gin.Context) {
	if content, err := global.SystemSetting.GetValueString(systemSetting.DISCLAIMER); err != nil {
		global.SystemSetting.Set(systemSetting.DISCLAIMER, "")
		apiReturn.SuccessData(c, "")
		return
	} else {
		apiReturn.SuccessData(c, content)
	}
}

func (a *Openness) GetAboutDescription(c *gin.Context) {
	if content, err := global.SystemSetting.GetValueString(systemSetting.WEB_ABOUT_DESCRIPTION); err != nil {
		global.SystemSetting.Set(systemSetting.WEB_ABOUT_DESCRIPTION, "")
		apiReturn.SuccessData(c, "")
		return
	} else {
		apiReturn.SuccessData(c, content)
	}
}

// GetSiteInfo 返回全局品牌信息（站点标题、图标、登录页背景），无需认证。
func (a *Openness) GetSiteInfo(c *gin.Context) {
	branding := gin.H{"siteTitle": "", "siteFavicon": "", "loginBackground": ""}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_TITLE); err == nil {
		branding["siteTitle"] = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_FAVICON); err == nil {
		branding["siteFavicon"] = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.LOGIN_BACKGROUND); err == nil {
		branding["loginBackground"] = value
	}
	apiReturn.SuccessData(c, branding)
}
