package system

import (
	"panel-next/api/api_v1/common/apiData/systemApiStructs"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/models"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

type NoticeApi struct {
}

func (a *NoticeApi) GetListByDisplayType(c *gin.Context) {
	req := systemApiStructs.NoticeGetListByDisplayTypeReq{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	noticeList := []models.Notice{}
	if err := global.Db.Find(&noticeList, "display_type in ?", req.DisplayType).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessListData(c, noticeList, 0)
}
