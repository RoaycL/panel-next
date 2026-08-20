package system

import "github.com/gin-gonic/gin"

func Init(routerGroup *gin.RouterGroup) {
	InitClientCapabilities(routerGroup)
	InitSync(routerGroup)
	InitAbout(routerGroup)
	InitLogin(routerGroup)
	InitUserRouter(routerGroup)
	InitFileRouter(routerGroup)
	InitNoticeRouter(routerGroup)
	InitModuleConfigRouter(routerGroup)
	InitMonitorRouter(routerGroup)
	InitBackupRouter(routerGroup)
	InitSiteSettingRouter(routerGroup)
	InitImgbedRouter(routerGroup)
	InitPublicFileRouter(routerGroup)
	InitDockerRouter(routerGroup)
	InitOpenAPIRouter(routerGroup)
}
