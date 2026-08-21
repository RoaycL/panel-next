package api_v1

import (
	"panel-next/api/api_v1/openness"
	"panel-next/api/api_v1/panel"
	"panel-next/api/api_v1/system"
)

type ApiGroup struct {
	ApiSystem system.ApiSystem // 系统功能api
	ApiOpen   openness.ApiOpenness
	ApiPanel  panel.ApiPanel
}

var ApiGroupApp = new(ApiGroup)
