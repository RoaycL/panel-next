package system

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	"panel-next/lib/cmn"
	"panel-next/models"
	"panel-next/models/datatype"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
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

	iconJson, _ := json.Marshal(req.Icon)
	if req.RemoteIconUrl != "" {
		// API-03: 下载远程图标到本地
		configUpload := global.Config.GetValueString("base", "source_path")
		savePath := configUpload + "/openapi/"
		if isExist, _ := cmn.PathExists(savePath); !isExist {
			os.MkdirAll(savePath, 0o755)
		}
		if localPath, err := downloadRemoteIcon(req.RemoteIconUrl, savePath); err == nil {
			req.Icon.Src = localPath[1:]
			req.Icon.ItemType = 2
			iconJson, _ = json.Marshal(req.Icon)
		}
	}

	item := models.ItemIcon{
		Title:           req.Title,
		Url:             req.Url,
		LanUrl:          req.LanUrl,
		Description:     req.Description,
		OpenMethod:      req.OpenMethod,
		ItemIconGroupId: req.ItemIconGroupId,
		IconJson:        string(iconJson),
		UserId:          userInfo.ID,
	}
	if err := global.Db.Create(&item).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	// 反序列化 icon 供响应
	json.Unmarshal([]byte(item.IconJson), &item.Icon)
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

	var existing models.ItemIcon
	if err := global.Db.First(&existing, "id = ? AND user_id = ?", id, userInfo.ID).Error; err != nil {
		apiReturn.ErrorDataNotFound(c)
		return
	}

	req := make(map[string]interface{})
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	updates := make(map[string]interface{})
	if v, ok := req["title"]; ok {
		updates["title"] = v
	}
	if v, ok := req["url"]; ok {
		updates["url"] = v
	}
	if v, ok := req["lanUrl"]; ok {
		updates["lan_url"] = v
	}
	if v, ok := req["description"]; ok {
		updates["description"] = v
	}
	if v, ok := req["openMethod"]; ok {
		updates["open_method"] = v
	}
	if v, ok := req["itemIconGroupId"]; ok {
		updates["item_icon_group_id"] = v
	}
	if v, ok := req["icon"]; ok {
		iconJson, _ := json.Marshal(v)
		updates["icon_json"] = string(iconJson)
	}

	if len(updates) == 0 {
		apiReturn.SuccessData(c, existing)
		return
	}

	if err := global.Db.Model(&existing).Where("id = ? AND user_id = ?", id, userInfo.ID).Updates(updates).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	global.Db.First(&existing, id)
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
	if err := global.Db.Create(&group).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, group)
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
	global.Db.Where("item_icon_group_id = ?", id).Order("sort asc").Find(&items)
	for i := range items {
		json.Unmarshal([]byte(items[i].IconJson), &items[i].Icon)
	}
	apiReturn.SuccessData(c, gin.H{
		"group": group,
		"items": items,
	})
}

// downloadRemoteIcon 下载远程图标到本地（API-03）
func downloadRemoteIcon(url, savePath string) (string, error) {
	fileName := cmn.Md5(url+time.Now().String()) + ".png"
	filepath := savePath + fileName

	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	out, err := os.Create(filepath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return "", err
	}
	return filepath, nil
}
