package router

import (
	"html"
	"net/http"
	"os"
	"regexp"
	"strings"

	"panel-next/global"
	"panel-next/lib/cmn/systemSetting"

	"github.com/gin-gonic/gin"
)

var (
	titlePattern   = regexp.MustCompile(`<title>[^<]*</title>`)
	faviconPattern = regexp.MustCompile(`<link rel="icon"[^>]*>`)
)

// readSiteBrandingForPage 读取注入首页所需的品牌设置，缺失时回退空值。
func readSiteBrandingForPage() (siteTitle, siteFavicon, globalCSS, globalJS string) {
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_TITLE); err == nil {
		siteTitle = strings.TrimSpace(value)
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.SITE_FAVICON); err == nil {
		siteFavicon = strings.TrimSpace(value)
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.GLOBAL_INDEX_CSS); err == nil {
		globalCSS = value
	}
	if value, err := global.SystemSetting.GetValueString(systemSetting.GLOBAL_INDEX_JS); err == nil {
		globalJS = value
	}
	return siteTitle, siteFavicon, globalCSS, globalJS
}

// injectSiteBranding 将站点标题、图标与全局自定义 CSS/JS 注入构建产物 index.html。
// 全局脚本仅当 DB 有值时内联；为空时保留 index.html 中 /custom/index.* 的文件引用。
func injectSiteBranding(pageHTML, siteTitle, siteFavicon, globalCSS, globalJS string) string {
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
	if globalCSS != "" {
		pageHTML = strings.Replace(pageHTML, `<link rel="stylesheet"  href="/custom/index.css">`, "<style>\n"+globalCSS+"\n</style>", 1)
	}
	if globalJS != "" {
		pageHTML = strings.Replace(pageHTML, `<script src="/custom/index.js"></script>`, "<script>\n"+globalJS+"\n</script>", 1)
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
		siteTitle, siteFavicon, globalCSS, globalJS := readSiteBrandingForPage()
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(injectSiteBranding(pageHTML, siteTitle, siteFavicon, globalCSS, globalJS)))
	})
	return nil
}
