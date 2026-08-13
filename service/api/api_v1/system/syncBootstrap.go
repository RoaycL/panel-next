package system

import (
	"encoding/json"
	"strconv"
	"time"

	"sun-panel/api/api_v1/common/apiData/syncApiStructs"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SyncBootstrapApi struct{}

var syncBootstrapNow = time.Now

func (a *SyncBootstrapApi) Get(c *gin.Context) {
	if mode, _ := c.Get(sessionlib.GinAuthModeKey); mode != sessionlib.AuthModeDevice {
		apiReturn.ErrorByCode(c, 1001)
		return
	}
	if _, ok := applyAPIVersionNegotiation(c); !ok {
		return
	}
	user, exists := base.GetCurrentUserInfo(c)
	if !exists || user.ID == 0 {
		apiReturn.ErrorByCode(c, 1001)
		return
	}

	response, err := buildSyncBootstrap(c, user)
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, response)
}

func buildSyncBootstrap(c *gin.Context, user models.User) (syncApiStructs.BootstrapResponse, error) {
	response := syncApiStructs.BootstrapResponse{
		SchemaVersion: syncApiStructs.BootstrapSchemaVersion,
		Revision:      "0",
		GeneratedAt:   syncBootstrapNow().UTC(),
		Account: syncApiStructs.BootstrapAccount{
			ID: user.ID, Username: user.Username, Name: user.Name, HeadImage: user.HeadImage,
			Role: user.Role, Mail: user.Mail, Status: user.Status,
		},
		Panel: syncApiStructs.BootstrapPanel{
			Revision: "0", Config: map[string]interface{}{}, SearchEngine: map[string]interface{}{},
			Groups: make([]syncApiStructs.BootstrapGroup, 0),
		},
	}
	var maximumRevision int64
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var config models.UserConfig
		if err := tx.First(&config, "user_id = ?", user.ID).Error; err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if config.UserId != 0 {
			decodeMap(config.PanelJson, &response.Panel.Config)
			decodeMap(config.SearchEngineJson, &response.Panel.SearchEngine)
			response.Panel.Revision = formatSyncRevision(config.Revision)
			maximumRevision = maxSyncRevision(maximumRevision, config.Revision)
		}

		var groups []models.ItemIconGroup
		if err := tx.Order("sort, created_at, id").Where("user_id = ?", user.ID).Find(&groups).Error; err != nil {
			return err
		}
		if len(groups) == 0 {
			defaultGroup := models.ItemIconGroup{Title: "APP", UserId: user.ID, Icon: "material-symbols:ad-group-outline"}
			if err := tx.Create(&defaultGroup).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.ItemIcon{}).Where("user_id = ? AND item_icon_group_id = 0", user.ID).
				Update("item_icon_group_id", defaultGroup.ID).Error; err != nil {
				return err
			}
			groups = append(groups, defaultGroup)
		}

		groupIndexes := make(map[uint]int, len(groups))
		for _, group := range groups {
			groupIndexes[group.ID] = len(response.Panel.Groups)
			response.Panel.Groups = append(response.Panel.Groups, syncApiStructs.BootstrapGroup{
				ID: group.ID, CreateTime: group.CreatedAt, UpdateTime: group.UpdatedAt,
				Icon: group.Icon, Title: group.Title, Description: group.Description,
				Sort: group.Sort, Revision: formatSyncRevision(group.Revision),
				Items: make([]syncApiStructs.BootstrapItem, 0),
			})
			maximumRevision = maxSyncRevision(maximumRevision, group.Revision)
		}

		var items []models.ItemIcon
		if err := tx.Order("item_icon_group_id, sort, created_at, id").Where("user_id = ?", user.ID).Find(&items).Error; err != nil {
			return err
		}
		for _, item := range items {
			index, found := groupIndexes[uint(item.ItemIconGroupId)]
			if !found {
				continue
			}
			_ = json.Unmarshal([]byte(item.IconJson), &item.Icon)
			response.Panel.Groups[index].Items = append(response.Panel.Groups[index].Items, syncApiStructs.BootstrapItem{
				ID: item.ID, CreateTime: item.CreatedAt, UpdateTime: item.UpdatedAt,
				Icon: item.Icon, Title: item.Title, URL: item.Url, LANURL: item.LanUrl,
				Description: item.Description, OpenMethod: item.OpenMethod, Sort: item.Sort,
				Revision: formatSyncRevision(item.Revision), ItemIconGroupID: uint(item.ItemIconGroupId),
			})
			maximumRevision = maxSyncRevision(maximumRevision, item.Revision)
		}

		var syncState models.UserSyncState
		if err := tx.First(&syncState, "user_id = ?", user.ID).Error; err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		maximumRevision = maxSyncRevision(maximumRevision, syncState.Revision)
		return nil
	})
	if err != nil {
		return syncApiStructs.BootstrapResponse{}, err
	}
	response.Revision = formatSyncRevision(maximumRevision)
	return response, nil
}

func decodeMap(raw string, destination *map[string]interface{}) {
	if raw == "" || json.Unmarshal([]byte(raw), destination) != nil || *destination == nil {
		*destination = map[string]interface{}{}
	}
}

func formatSyncRevision(revision int64) string {
	if revision < 0 {
		revision = 0
	}
	return strconv.FormatInt(revision, 10)
}

func maxSyncRevision(current, candidate int64) int64 {
	if candidate > current {
		return candidate
	}
	return current
}
