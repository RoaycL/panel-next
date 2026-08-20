package system

import (
	"strings"
	"unicode/utf8"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/global"
	"sun-panel/lib/cmn/systemSetting"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const (
	maxSiteTitleLength    = 80
	maxBrandingPathLength = 500
)

type SiteSettingApi struct{}

type siteBranding struct {
	SiteTitle       string `json:"siteTitle"`
	SiteFavicon     string `json:"siteFavicon"`
	LoginBackground string `json:"loginBackground"`
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

	if err := global.SystemSetting.Set(systemSetting.SITE_TITLE, req.SiteTitle); err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	if err := global.SystemSetting.Set(systemSetting.SITE_FAVICON, req.SiteFavicon); err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	if err := global.SystemSetting.Set(systemSetting.LOGIN_BACKGROUND, req.LoginBackground); err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, readSiteBranding())
}
