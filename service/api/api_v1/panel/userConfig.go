package panel

import (
	"encoding/json"
	"strconv"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	"sun-panel/lib/syncstate"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UserConfig struct {
}

func (a *UserConfig) Get(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	cfg := models.UserConfig{}
	if err := global.Db.First(&cfg, "user_id=?", userInfo.ID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			apiReturn.ErrorDataNotFound(c)
			return
		} else {
			apiReturn.ErrorDatabase(c, err.Error())
			return
		}
	}

	// 处理字段
	if err := json.Unmarshal([]byte(cfg.PanelJson), &cfg.Panel); err != nil {
		cfg.Panel = nil
	}
	if err := json.Unmarshal([]byte(cfg.SearchEngineJson), &cfg.SearchEngine); err != nil {
		cfg.SearchEngine = nil
	}
	apiReturn.SuccessData(c, cfg)

}

func (a *UserConfig) Set(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req, expectedRevision, ok := bindSyncMutation[models.UserConfig](c)
	if !ok {
		return
	}

	// 处理字段
	if jb, err := json.Marshal(req.Panel); err != nil {
		req.PanelJson = "{}"
	} else {
		req.PanelJson = string(jb)
	}

	if jb, err := json.Marshal(req.SearchEngine); err != nil {
		req.SearchEngineJson = "{}"
	} else {
		req.SearchEngineJson = string(jb)
	}

	req.UserId = userInfo.ID
	var revision int64
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var stored models.UserConfig
		if err := tx.First(&stored, "user_id = ?", userInfo.ID).Error; err != nil {
			if err != gorm.ErrRecordNotFound {
				return err
			}
			stored = models.UserConfig{UserId: userInfo.ID, PanelJson: "{}", SearchEngineJson: "{}"}
			if err := tx.Create(&stored).Error; err != nil {
				return err
			}
		}
		var err error
		revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: syncstate.AppendRequest{
			UserID: userInfo.ID, ResourceType: models.SyncResourcePanel,
			ResourceID: strconv.FormatUint(uint64(userInfo.ID), 10), Operation: models.SyncOperationUpsert,
		}, ExpectedRevision: expectedRevision}, func(next int64) (any, error) {
			// 未提交的配置段保持原值，避免部分保存清空另一段配置。
			updates := map[string]any{"revision": next}
			if req.Panel != nil {
				updates["panel_json"] = req.PanelJson
			}
			if req.SearchEngine != nil {
				updates["search_engine_json"] = req.SearchEngineJson
			}
			result := tx.Model(&models.UserConfig{}).Where("user_id = ?", userInfo.ID).Updates(updates)
			if result.Error != nil {
				return nil, result.Error
			}
			return map[string]any{
				"revision": strconv.FormatInt(next, 10), "config": req.Panel, "searchEngine": req.SearchEngine,
			}, nil
		})
		return err
	})
	if err != nil {
		returnSyncMutationError(c, err)
		return
	}
	returnSyncMutation(c, revision, nil)
}
