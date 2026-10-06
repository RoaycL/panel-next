package system

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/api/api_v1/panel"
	"panel-next/global"
	"panel-next/lib/cmn"
	"panel-next/lib/safehttp"
	"panel-next/lib/siteFavicon"
	"panel-next/lib/syncstate"
	"panel-next/models"
	"panel-next/models/datatype"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"gorm.io/gorm"
)

type OpenAPIApi struct{}

// API-05: 无参数版本/连通性接口
func (a *OpenAPIApi) GetVersion(c *gin.Context) {
	version := cmn.GetSysVersionInfo()
	apiReturn.SuccessData(c, gin.H{
		"version":      version.Version,
		"version_code": version.Version_code,
		"product":      "panel-next",
	})
}

// API-01: 创建卡片
func (a *OpenAPIApi) CreateItem(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req := struct {
		Title           string                    `json:"title"`
		Url             string                    `json:"url"`
		LanUrl          string                    `json:"lanUrl"`
		Description     string                    `json:"description"`
		OpenMethod      int                       `json:"openMethod"`
		ItemIconGroupId int                       `json:"itemIconGroupId"`
		Icon            datatype.ItemIconIconInfo `json:"icon"`
		// API-03: 远程图标 URL，保存到本地
		RemoteIconUrl string `json:"remoteIconUrl"`
	}{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	if req.Title == "" || req.Url == "" {
		apiReturn.ErrorParamFomat(c, "title and url")
		return
	}
	if req.ItemIconGroupId <= 0 {
		apiReturn.ErrorParamFomat(c, "itemIconGroupId")
		return
	}

	if req.RemoteIconUrl != "" {
		// API-03: 下载远程图标到本地
		localPath, err := downloadRemoteIcon(c.Request.Context(), userInfo.ID, req.RemoteIconUrl)
		if err != nil {
			apiReturn.Error(c, "remote icon: "+err.Error())
			return
		}
		req.Icon.Src = localPath[1:]
		req.Icon.ItemType = 2
	}
	iconJson, _ := json.Marshal(req.Icon)

	item := models.ItemIcon{
		Title:           req.Title,
		Url:             req.Url,
		LanUrl:          req.LanUrl,
		Description:     req.Description,
		OpenMethod:      req.OpenMethod,
		ItemIconGroupId: req.ItemIconGroupId,
		IconJson:        string(iconJson),
		UserId:          userInfo.ID,
		Sort:            9999,
	}
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := ensureOwnGroup(tx, userInfo.ID, item.ItemIconGroupId); err != nil {
			return err
		}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		return journalItem(tx, &item)
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiReturn.ErrorDataNotFound(c)
		return
	}
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, item)
}

// API-01: 查询卡片列表
func (a *OpenAPIApi) GetItems(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	groupId := c.Query("groupId")
	var items []models.ItemIcon
	query := global.Db.Where("user_id = ?", userInfo.ID)
	if groupId != "" {
		query = query.Where("item_icon_group_id = ?", groupId)
	}
	if err := query.Order("sort asc").Find(&items).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	for i := range items {
		json.Unmarshal([]byte(items[i].IconJson), &items[i].Icon)
	}
	apiReturn.SuccessListData(c, items, int64(len(items)))
}

// API-01/API-04: 更新卡片（补丁语义，未传字段保持原值）
func (a *OpenAPIApi) UpdateItem(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		apiReturn.ErrorParamFomat(c, "id")
		return
	}

	// Typed pointers keep patch semantics (absent = unchanged) and reject
	// values of the wrong type before they reach the database.
	req := struct {
		Title           *string                    `json:"title"`
		Url             *string                    `json:"url"`
		LanUrl          *string                    `json:"lanUrl"`
		Description     *string                    `json:"description"`
		OpenMethod      *int                       `json:"openMethod"`
		ItemIconGroupId *int                       `json:"itemIconGroupId"`
		Icon            *datatype.ItemIconIconInfo `json:"icon"`
	}{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Url != nil {
		updates["url"] = *req.Url
	}
	if req.LanUrl != nil {
		updates["lan_url"] = *req.LanUrl
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.OpenMethod != nil {
		updates["open_method"] = *req.OpenMethod
	}
	if req.ItemIconGroupId != nil {
		updates["item_icon_group_id"] = *req.ItemIconGroupId
	}
	if req.Icon != nil {
		iconJson, _ := json.Marshal(req.Icon)
		updates["icon_json"] = string(iconJson)
	}

	var existing models.ItemIcon
	err = global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&existing, "id = ? AND user_id = ?", id, userInfo.ID).Error; err != nil {
			return err
		}
		if len(updates) == 0 {
			return nil
		}
		if req.ItemIconGroupId != nil {
			if err := ensureOwnGroup(tx, userInfo.ID, *req.ItemIconGroupId); err != nil {
				return err
			}
		}
		if err := tx.Model(&models.ItemIcon{}).Where("id = ? AND user_id = ?", id, userInfo.ID).Updates(updates).Error; err != nil {
			return err
		}
		if err := tx.First(&existing, "id = ? AND user_id = ?", id, userInfo.ID).Error; err != nil {
			return err
		}
		return journalItem(tx, &existing)
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiReturn.ErrorDataNotFound(c)
		return
	}
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	json.Unmarshal([]byte(existing.IconJson), &existing.Icon)
	apiReturn.SuccessData(c, existing)
}

// API-02: 创建分组
func (a *OpenAPIApi) CreateGroup(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req := struct {
		Title string `json:"title"`
		Icon  string `json:"icon"`
	}{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	if req.Title == "" {
		apiReturn.ErrorParamFomat(c, "title")
		return
	}
	group := models.ItemIconGroup{
		Title:  req.Title,
		Icon:   req.Icon,
		UserId: userInfo.ID,
	}
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&group).Error; err != nil {
			return err
		}
		_, err := syncstate.ContinueMutationTx(tx, syncstate.AppendRequest{
			UserID: userInfo.ID, ResourceType: models.SyncResourceGroup,
			ResourceID: strconv.FormatUint(uint64(group.ID), 10), Operation: models.SyncOperationUpsert,
		}, func(revision int64) (any, error) {
			if err := tx.Model(&models.ItemIconGroup{}).Where("id = ?", group.ID).Update("revision", revision).Error; err != nil {
				return nil, err
			}
			group.Revision = revision
			return panel.GroupChangePayload(group), nil
		})
		return err
	})
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, group)
}

// ensureOwnGroup rejects group ids that belong to another account.
func ensureOwnGroup(tx *gorm.DB, userID uint, groupID int) error {
	var group models.ItemIconGroup
	return tx.Select("id").First(&group, "id = ? AND user_id = ?", groupID, userID).Error
}

// journalItem records an OpenAPI item write in the sync log so other devices
// pick it up through incremental sync, like edits made in the panel.
func journalItem(tx *gorm.DB, item *models.ItemIcon) error {
	_, err := syncstate.ContinueMutationTx(tx, syncstate.AppendRequest{
		UserID: item.UserId, ResourceType: models.SyncResourceItem,
		ResourceID: strconv.FormatUint(uint64(item.ID), 10), Operation: models.SyncOperationUpsert,
	}, func(revision int64) (any, error) {
		if err := tx.Model(&models.ItemIcon{}).Where("id = ?", item.ID).Update("revision", revision).Error; err != nil {
			return nil, err
		}
		item.Revision = revision
		_ = json.Unmarshal([]byte(item.IconJson), &item.Icon)
		return panel.ItemChangePayload(*item), nil
	})
	return err
}

// API-02: 查询分组列表
func (a *OpenAPIApi) GetGroups(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	var groups []models.ItemIconGroup
	if err := global.Db.Where("user_id = ?", userInfo.ID).Order("sort asc").Find(&groups).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessListData(c, groups, int64(len(groups)))
}

// API-02: 查询分组详情
func (a *OpenAPIApi) GetGroupDetail(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		apiReturn.ErrorParamFomat(c, "id")
		return
	}
	var group models.ItemIconGroup
	if err := global.Db.First(&group, "id = ? AND user_id = ?", id, userInfo.ID).Error; err != nil {
		apiReturn.ErrorDataNotFound(c)
		return
	}
	// 包含分组下的卡片
	var items []models.ItemIcon
	global.Db.Where("item_icon_group_id = ? AND user_id = ?", id, userInfo.ID).Order("sort asc").Find(&items)
	for i := range items {
		json.Unmarshal([]byte(items[i].IconJson), &items[i].Icon)
	}
	apiReturn.SuccessData(c, gin.H{
		"group": group,
		"items": items,
	})
}

// downloadRemoteIcon 下载远程图标到本地（API-03）。只连接公网地址（DNS 解析与
// 每次跳转后都会校验），只保存真正的图片，并登记到文件表便于清理。
func downloadRemoteIcon(ctx context.Context, userID uint, iconURL string) (string, error) {
	if _, err := safehttp.ValidateURL(iconURL); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, iconURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 PanelNext/1.0")
	resp, err := remoteIconClient.Do(request)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("icon download returned %d", resp.StatusCode)
	}
	const maxIconBytes = 2 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxIconBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxIconBytes {
		return "", fmt.Errorf("icon larger than 2 MB")
	}
	ext, err := siteFavicon.ImageExtension(data)
	if err != nil {
		return "", err
	}

	savePath := global.Config.GetValueString("base", "source_path") + "/openapi/"
	if err := os.MkdirAll(savePath, 0o755); err != nil {
		return "", err
	}
	filepath := savePath + cmn.Md5(iconURL+time.Now().String()) + ext
	if err := os.WriteFile(filepath, data, 0o644); err != nil {
		return "", err
	}
	mFile := models.File{}
	if _, err := mFile.AddFileWithType(userID, iconURL, ext, filepath, "icon"); err != nil {
		os.Remove(filepath)
		return "", err
	}
	return filepath, nil
}

var remoteIconClient = safehttp.NewClient(10 * time.Second)
