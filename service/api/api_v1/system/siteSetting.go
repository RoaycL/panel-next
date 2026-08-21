package system

import (
	"strings"
	"unicode/utf8"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/lib/cmn/systemSetting"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const (
	maxSiteTitleLength    = 80
	maxBrandingPathLength = 500
	maxGlobalScriptLength = 256 << 10 // 256KB
)

type SiteSettingApi struct{}

type siteBranding struct {
	SiteTitle       string `json:"siteTitle"`
	SiteFavicon     string `json:"siteFavicon"`
	LoginBackground string `json:"loginBackground"`
	GlobalIndexCSS  string `json:"globalIndexCss"`
	GlobalIndexJS   string `json:"globalIndexJs"`
}

func readSiteBranding() siteBranding {
	branding := siteBranding{}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_TITLE); err == nil {
		branding.SiteTitle = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_FAVICON); err == nil {
		branding.SiteFavicon = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.LOGIN_BACKGROUND); err == nil {
		branding.LoginBackground = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.GLOBAL_INDEX_CSS); err == nil {
		branding.GlobalIndexCSS = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.GLOBAL_INDEX_JS); err == nil {
		branding.GlobalIndexJS = value
	}
	return branding
}

// validateBrandingPath 只允许空值或以单个 / 开头的同源路径，拒绝协议、查询与片段。
func validateBrandingPath(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > maxBrandingPathLength || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return false
	}
	if strings.ContainsAny(value, "?#") || strings.Contains(value, "\\") || strings.Contains(value, "..") {
		return false
	}
	return true
}

// validateGlobalScript 限制全局自定义脚本大小，空值视为合法。
func validateGlobalScript(value string) bool {
	return value == "" || len(value) <= maxGlobalScriptLength
}

func (a *SiteSettingApi) Get(c *gin.Context) {
	apiReturn.SuccessData(c, readSiteBranding())
}

func (a *SiteSettingApi) Set(c *gin.Context) {
	req := siteBranding{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	req.SiteTitle = strings.TrimSpace(req.SiteTitle)
	if utf8.RuneCountInString(req.SiteTitle) > maxSiteTitleLength {
		apiReturn.ErrorParamFomat(c, "siteTitle")
		return
	}
	if !validateBrandingPath(req.SiteFavicon) || !validateBrandingPath(req.LoginBackground) {
		apiReturn.ErrorParamFomat(c, "siteFavicon or loginBackground")
		return
	}
	if !validateGlobalScript(req.GlobalIndexCSS) || !validateGlobalScript(req.GlobalIndexJS) {
		apiReturn.ErrorParamFomat(c, "globalIndexCss or globalIndexJs")
		return
	}

	for _, pair := range []struct {
		name  string
		value string
	}{
		{systemSetting.SITE_TITLE, req.SiteTitle},
		{systemSetting.SITE_FAVICON, req.SiteFavicon},
		{systemSetting.LOGIN_BACKGROUND, req.LoginBackground},
		{systemSetting.GLOBAL_INDEX_CSS, req.GlobalIndexCSS},
		{systemSetting.GLOBAL_INDEX_JS, req.GlobalIndexJS},
	} {
		if err := global.SystemSetting.Set(pair.name, pair.value); err != nil {
			apiReturn.ErrorDatabase(c, err.Error())
			return
		}
	}
	apiReturn.SuccessData(c, readSiteBranding())
}
