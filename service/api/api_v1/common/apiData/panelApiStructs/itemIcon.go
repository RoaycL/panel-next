package panelApiStructs

import (
	"panel-next/api/api_v1/common/apiData/commonApiStructs"
	"panel-next/models"
)

type ItemIconEditRequest struct {
	models.ItemIcon
	IconJson string
}

type ItemIconSaveSortRequest struct {
	SortItems       []commonApiStructs.SortRequestItem `json:"sortItems"`
	ItemIconGroupId uint                               `json:"itemIconGroupId"`
}

type ItemIconGetSiteFaviconReq struct {
	Url string `json:"url"`
}

type ItemIconGetSiteFaviconResp struct {
	IconUrl  string   `json:"iconUrl"`
	IconUrls []string `json:"iconUrls,omitempty"` // CARD-07: 所有候选图标
}
