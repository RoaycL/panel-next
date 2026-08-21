package router

import (
	"net/http"
	"os"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/lib/cmn"
	corslib "panel-next/lib/cors"
	"panel-next/router/openness"
	"panel-next/router/panel"
	"panel-next/router/system"

	"github.com/gin-gonic/gin"
)

// 初始化总路由
func InitRouters(addr string) error {
	router := gin.Default()
	corsPolicy, err := corslib.NewPolicy(
		global.Config.GetValueStringOrDefault("cors", "web_origins"),
		global.Config.GetValueStringOrDefault("cors", "extension_ids"),
	)
	if err != nil {
		return err
	}
	router.Use(corsPolicy.Handler())
	rootRouter := router.Group("/")
	routerGroup := rootRouter.Group("api")

	// 接口
	system.Init(routerGroup)
	panel.Init(routerGroup)
	openness.Init(routerGroup)

	// WEB文件服务
	{
		webPath := global.Config.GetValueStringOrDefault("base", "web_path")
		if webPath == "" {
			webPath = "./web"
		}
		if err := registerIndexPage(router, webPath); err != nil {
			return err
		}
		router.Static("/assets", webPath+"/assets")
		router.Static("/custom", webPath+"/custom")
		router.StaticFile("/favicon.ico", webPath+"/favicon.ico")
		router.StaticFile("/favicon.svg", webPath+"/favicon.svg")
	}

	// 上传的文件
	// OPS-04: 托管额外静态文件如 robots.txt
	{
		webPath := global.Config.GetValueStringOrDefault("base", "web_path")
		if webPath == "" {
			webPath = "./web"
		}
		robotsPath := webPath + "/robots.txt"
		if _, err := os.Stat(robotsPath); err == nil {
			router.StaticFile("/robots.txt", robotsPath)
		}
	}

	// OPS-06: /clear 清理前端本地缓存并要求重新登录
	router.GET("/clear", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(clearPageHTML))
	})

	sourcePath := global.Config.GetValueString("base", "source_path")
	router.Static(sourcePath[1:], sourcePath)

	// OPS-05: 在线检查新版本（代理但不执行升级）
	router.GET("/api/v1/openapi/check-update", func(c *gin.Context) {
		version := cmn.GetSysVersionInfo()
		apiReturn.SuccessData(c, gin.H{
			"current_version":      version.Version,
			"current_version_code": version.Version_code,
			"latest":               nil, // 不自动获取，前端可自行检查
		})
	})

	// OPS-03: 原生 HTTPS
	httpsPort := global.Config.GetValueString("base", "https_port")
	if httpsPort != "" {
		certPath := global.Config.GetValueString("base", "https_cert")
		keyPath := global.Config.GetValueString("base", "https_key")
		if certPath != "" && keyPath != "" {
			go func() {
				global.Logger.Info("Starting HTTPS server on :" + httpsPort)
				if err := router.RunTLS(":"+httpsPort, certPath, keyPath); err != nil {
					global.Logger.Errorln("HTTPS server failed:", err)
				}
			}()
		}
	}

	global.Logger.Info("Panel Next is Started.  Listening and serving HTTP on ", addr)
	return router.Run(addr)
}

const clearPageHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Clear Cache</title></head>
<body>
<p>Clearing local cache...</p>
<script>
try { localStorage.clear(); sessionStorage.clear(); } catch(e) {}
window.location.href = '/#/login';
</script>
</body>
</html>`
