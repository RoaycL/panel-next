package router

import (
	"html"
	"net/http"
	"os"
	"regexp"
	"strings"

	"sun-panel/global"
	"sun-panel/lib/cmn/systemSetting"

	"github.com/gin-gonic/gin"
)

var (
	titlePattern   = regexp.MustCompile(`<title>[^<]*</title>`)
	faviconPattern = regexp.MustCompile(`<link rel="icon"[^>]*>`)
)

// readSiteBrandingForPage 读取注入首页所需的品牌设置，缺失时回退空值。
func readSiteBrandingForPage() (siteTitle, siteFavicon string) {
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_TITLE); err == nil {
		siteTitle = strings.TrimSpace(value)
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_FAVICON); err == nil {
		siteFavicon = strings.TrimSpace(value)
	}
	return siteTitle, siteFavicon
}

// injectSiteBranding 将站点标题与图标注入构建产物 index.html。
// 所有值都经过 HTML 转义；favicon 还必须是已通过接口校验的同源路径。
func injectSiteBranding(pageHTML, siteTitle, siteFavicon string) string {
	if siteTitle != "" {
		pageHTML = titlePattern.ReplaceAllString(pageHTML, "<title>"+html.EscapeString(siteTitle)+"</title>")
	}
	if siteFavicon != "" {
		replacement := `<link rel="icon" href="` + html.EscapeString(siteFavicon) + `">`
		if faviconPattern.MatchString(pageHTML) {
			pageHTML = faviconPattern.ReplaceAllString(pageHTML, replacement)
		} else {
			pageHTML = strings.Replace(pageHTML, "<title>", replacement+"<title>", 1)
		}
	}
	return pageHTML
}

// registerIndexPage 用动态注入替代静态 index.html，保存后刷新即可看到新标题与图标。
func registerIndexPage(router *gin.Engine, webPath string) error {
	raw, err := os.ReadFile(webPath + "/index.html")
	if err != nil {
		return err
	}
	pageHTML := string(raw)
	router.GET("/", func(c *gin.Context) {
		siteTitle, siteFavicon := readSiteBrandingForPage()
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(injectSiteBranding(pageHTML, siteTitle, siteFavicon)))
	})
	return nil
}
