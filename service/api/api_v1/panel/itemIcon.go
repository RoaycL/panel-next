package panel

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"panel-next/api/api_v1/common/apiData/commonApiStructs"
	"panel-next/api/api_v1/common/apiData/panelApiStructs"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	"panel-next/lib/cmn"
	"panel-next/lib/siteFavicon"
	"panel-next/lib/syncstate"
	"panel-next/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"gorm.io/gorm"
)

type ItemIcon struct {
}

func (a *ItemIcon) Edit(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req, expectedRevision, ok := bindSyncMutation[models.ItemIcon](c)
	if !ok {
		return
	}

	if req.ItemIconGroupId == 0 {
		// apiReturn.Error(c, "Group is mandatory")
		apiReturn.ErrorParamFomat(c, "Group is mandatory")
		return
	}

	req.UserId = userInfo.ID

	// json转字符串
	if j, err := json.Marshal(req.Icon); err == nil {
		req.IconJson = string(j)
	}

	var revision int64
	var stored models.ItemIcon
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var group models.ItemIconGroup
		if err := tx.First(&group, "id = ? AND user_id = ?", req.ItemIconGroupId, userInfo.ID).Error; err != nil {
			return err
		}
		if req.ID == 0 {
			req.Sort = 9999
			stored = req
			if err := tx.Create(&stored).Error; err != nil {
				return err
			}
		} else if err := tx.First(&stored, "id = ? AND user_id = ?", req.ID, userInfo.ID).Error; err != nil {
			return err
		}
		var err error
		revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: syncstate.AppendRequest{
			UserID: userInfo.ID, ResourceType: models.SyncResourceItem,
			ResourceID: strconv.FormatUint(uint64(stored.ID), 10), Operation: models.SyncOperationUpsert,
		}, ExpectedRevision: expectedRevision}, func(next int64) (any, error) {
			updates := map[string]any{
				"icon_json": req.IconJson, "title": req.Title, "url": req.Url, "lan_url": req.LanUrl,
				"description": req.Description, "open_method": req.OpenMethod,
				"item_icon_group_id": req.ItemIconGroupId, "revision": next,
			}
			if req.Sort != 0 {
				updates["sort"] = req.Sort
			}
			result := tx.Model(&models.ItemIcon{}).Where("id = ? AND user_id = ?", stored.ID, userInfo.ID).Updates(updates)
			if result.Error != nil {
				return nil, result.Error
			}
			if err := tx.First(&stored, stored.ID).Error; err != nil {
				return nil, err
			}
			_ = json.Unmarshal([]byte(stored.IconJson), &stored.Icon)
			return itemChangePayload(stored), nil
		})
		return err
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apiReturn.ErrorDataNotFound(c)
			return
		}
		returnSyncMutationError(c, err)
		return
	}
	returnSyncMutation(c, revision, stored)
}

func itemChangePayload(item models.ItemIcon) map[string]any {
	return map[string]any{
		"id": item.ID, "createTime": item.CreatedAt, "updateTime": item.UpdatedAt,
		"icon": item.Icon, "title": item.Title, "url": item.Url, "lanUrl": item.LanUrl,
		"description": item.Description, "openMethod": item.OpenMethod, "sort": item.Sort,
		"revision": strconv.FormatInt(item.Revision, 10), "itemIconGroupId": item.ItemIconGroupId,
	}
}

// 添加多个图标
func (a *ItemIcon) AddMultiple(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req, expectedRevision, ok := bindSyncMutation[[]models.ItemIcon](c)
	if !ok {
		return
	}
	if len(req) == 0 {
		apiReturn.ErrorParamFomat(c, "at least one item is required")
		return
	}

	for i := 0; i < len(req); i++ {
		if req[i].ItemIconGroupId == 0 {
			apiReturn.ErrorParamFomat(c, "Group is mandatory")
			return
		}
		req[i].UserId = userInfo.ID
		// json转字符串
		if j, err := json.Marshal(req[i].Icon); err == nil {
			req[i].IconJson = string(j)
		}
	}

	var revision int64
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		for i := range req {
			var group models.ItemIconGroup
			if err := tx.First(&group, "id = ? AND user_id = ?", req[i].ItemIconGroupId, userInfo.ID).Error; err != nil {
				return err
			}
			if req[i].Sort == 0 {
				req[i].Sort = 9999
			}
			if err := tx.Create(&req[i]).Error; err != nil {
				return err
			}
			appendRequest := syncstate.AppendRequest{
				UserID: userInfo.ID, ResourceType: models.SyncResourceItem,
				ResourceID: strconv.FormatUint(uint64(req[i].ID), 10), Operation: models.SyncOperationUpsert,
			}
			mutation := func(next int64) (any, error) {
				if err := tx.Model(&models.ItemIcon{}).Where("id = ? AND user_id = ?", req[i].ID, userInfo.ID).Update("revision", next).Error; err != nil {
					return nil, err
				}
				req[i].Revision = next
				return itemChangePayload(req[i]), nil
			}
			var err error
			if i == 0 {
				revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: appendRequest, ExpectedRevision: expectedRevision}, mutation)
			} else {
				revision, err = syncstate.ContinueMutationTx(tx, appendRequest, mutation)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apiReturn.ErrorDataNotFound(c)
			return
		}
		returnSyncMutationError(c, err)
		return
	}
	returnSyncMutation(c, revision, req)
}

// // 获取详情
// func (a *ItemIcon) GetInfo(c *gin.Context) {
// 	req := systemApiStructs.AiDrawGetInfoReq{}

// 	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
// 		apiReturn.ErrorParamFomat(c, err.Error())
// 		return
// 	}

// 	userInfo, _ := base.GetCurrentUserInfo(c)

// 	aiDraw := models.AiDraw{}
// 	aiDraw.ID = req.ID
// 	if err := aiDraw.GetInfo(global.Db); err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			apiReturn.Error(c, "不存在记录")
// 			return
// 		}
// 		apiReturn.ErrorDatabase(c, err.Error())
// 		return
// 	}

// 	if userInfo.ID != aiDraw.UserID {
// 		apiReturn.ErrorNoAccess(c)
// 		return
// 	}

// 	apiReturn.SuccessData(c, aiDraw)
// }

func (a *ItemIcon) GetListByGroupId(c *gin.Context) {
	req := models.ItemIcon{}

	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	userInfo, _ := base.GetCurrentUserInfo(c)
	itemIcons := []models.ItemIcon{}

	if err := global.Db.Order("sort ,created_at").Find(&itemIcons, "item_icon_group_id = ? AND user_id=?", req.ItemIconGroupId, userInfo.ID).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}

	for k, v := range itemIcons {
		json.Unmarshal([]byte(v.IconJson), &itemIcons[k].Icon)
	}

	apiReturn.SuccessListData(c, itemIcons, 0)
}

func (a *ItemIcon) Deletes(c *gin.Context) {
	req, expectedRevision, ok := bindSyncMutation[commonApiStructs.RequestDeleteIds[uint]](c)
	if !ok {
		return
	}
	userInfo, _ := base.GetCurrentUserInfo(c)
	if len(req.Ids) == 0 {
		apiReturn.ErrorParamFomat(c, "at least one item id is required")
		return
	}
	var revision int64
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var items []models.ItemIcon
		if err := tx.Where("id in ? AND user_id = ?", req.Ids, userInfo.ID).Find(&items).Error; err != nil {
			return err
		}
		if len(items) != len(req.Ids) {
			return gorm.ErrRecordNotFound
		}
		for index, item := range items {
			appendRequest := syncstate.AppendRequest{UserID: userInfo.ID, ResourceType: models.SyncResourceItem,
				ResourceID: strconv.FormatUint(uint64(item.ID), 10), Operation: models.SyncOperationDelete}
			mutation := func(int64) (any, error) {
				return nil, tx.Delete(&models.ItemIcon{}, "id = ? AND user_id = ?", item.ID, userInfo.ID).Error
			}
			var err error
			if index == 0 {
				revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: appendRequest, ExpectedRevision: expectedRevision}, mutation)
			} else {
				revision, err = syncstate.ContinueMutationTx(tx, appendRequest, mutation)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apiReturn.ErrorDataNotFound(c)
			return
		}
		returnSyncMutationError(c, err)
		return
	}
	returnSyncMutation(c, revision, nil)
}

// 保存排序
func (a *ItemIcon) SaveSort(c *gin.Context) {
	req, expectedRevision, ok := bindSyncMutation[panelApiStructs.ItemIconSaveSortRequest](c)
	if !ok {
		return
	}

	userInfo, _ := base.GetCurrentUserInfo(c)

	if len(req.SortItems) == 0 {
		apiReturn.ErrorParamFomat(c, "at least one sort item is required")
		return
	}
	var revision int64
	transactionErr := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		for index, value := range req.SortItems {
			var item models.ItemIcon
			if err := tx.First(&item, "user_id = ? AND id = ? AND item_icon_group_id = ?", userInfo.ID, value.Id, req.ItemIconGroupId).Error; err != nil {
				return err
			}
			appendRequest := syncstate.AppendRequest{UserID: userInfo.ID, ResourceType: models.SyncResourceItem,
				ResourceID: strconv.FormatUint(uint64(item.ID), 10), Operation: models.SyncOperationUpsert}
			mutation := func(next int64) (any, error) {
				if err := tx.Model(&models.ItemIcon{}).Where("id = ? AND user_id = ?", item.ID, userInfo.ID).
					Updates(map[string]any{"sort": value.Sort, "revision": next}).Error; err != nil {
					return nil, err
				}
				item.Sort, item.Revision = int(value.Sort), next
				_ = json.Unmarshal([]byte(item.IconJson), &item.Icon)
				return itemChangePayload(item), nil
			}
			var err error
			if index == 0 {
				revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: appendRequest, ExpectedRevision: expectedRevision}, mutation)
			} else {
				revision, err = syncstate.ContinueMutationTx(tx, appendRequest, mutation)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})

	if transactionErr != nil {
		if errors.Is(transactionErr, gorm.ErrRecordNotFound) {
			apiReturn.ErrorDataNotFound(c)
			return
		}
		returnSyncMutationError(c, transactionErr)
		return
	}
	returnSyncMutation(c, revision, nil)
}

// 支持获取并直接下载对方网站图标到服务器
func (a *ItemIcon) GetSiteFavicon(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req := panelApiStructs.ItemIconGetSiteFaviconReq{}

	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	resp := panelApiStructs.ItemIconGetSiteFaviconResp{}
	fullUrl := ""
	if iconUrl, err := siteFavicon.GetOneFaviconURL(req.Url); err != nil {
		apiReturn.Error(c, "acquisition failed: get ico error:"+err.Error())
		return
	} else {
		fullUrl = iconUrl
	}

	parsedURL, err := url.Parse(req.Url)
	if err != nil {
		apiReturn.Error(c, "acquisition failed:"+err.Error())
		return
	}

	protocol := parsedURL.Scheme
	global.Logger.Debug("protocol:", protocol)
	global.Logger.Debug("fullUrl:", fullUrl)

	// 如果URL以双斜杠（//）开头，则使用当前页面协议
	if strings.HasPrefix(fullUrl, "//") {
		fullUrl = protocol + "://" + fullUrl[2:]
	} else if !strings.HasPrefix(fullUrl, "http://") && !strings.HasPrefix(fullUrl, "https://") {
		// 如果URL既不以http://开头也不以https://开头，则默认为http协议
		fullUrl = "http://" + fullUrl
	}
	global.Logger.Debug("fullUrl:", fullUrl)
	// 去除图标的get参数
	{
		parsedIcoURL, err := url.Parse(fullUrl)
		if err != nil {
			apiReturn.Error(c, "acquisition failed: parsed ico URL :"+err.Error())
			return
		}
		fullUrl = parsedIcoURL.Scheme + "://" + parsedIcoURL.Host + parsedIcoURL.Path
	}
	global.Logger.Debug("fullUrl:", fullUrl)

	// CARD-07: 获取所有候选图标 URL
	allIconURLs, _ := siteFavicon.GetAllFaviconURLs(req.Url)
	resp.IconUrls = make([]string, 0, len(allIconURLs))
	for _, iconURL := range allIconURLs {
		normalized := siteFavicon.NormalizeIconURL(iconURL, parsedURL.Scheme)
		if normalized != "" {
			resp.IconUrls = append(resp.IconUrls, normalized)
		}
	}

	// 生成保存目录
	configUpload := global.Config.GetValueString("base", "source_path")
	savePath := fmt.Sprintf("%s/%d/%d/%d/", configUpload, time.Now().Year(), time.Now().Month(), time.Now().Day())
	isExist, _ := cmn.PathExists(savePath)
	if !isExist {
		os.MkdirAll(savePath, os.ModePerm)
	}

	// 下载
	var imgInfo *os.File
	{
		var err error
		if imgInfo, err = siteFavicon.DownloadImage(fullUrl, savePath, 1024*1024); err != nil {
			apiReturn.Error(c, "acquisition failed: download"+err.Error())
			return
		}
	}

	// 保存到数据库
	ext := path.Ext(fullUrl)
	mFile := models.File{}
	if _, err := mFile.AddFile(userInfo.ID, parsedURL.Host, ext, imgInfo.Name()); err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	resp.IconUrl = imgInfo.Name()[1:]
	apiReturn.SuccessData(c, resp)
}
