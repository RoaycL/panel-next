package panel

import (
	"errors"
	"math"
	"strconv"
	"sun-panel/api/api_v1/common/apiData/commonApiStructs"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	"sun-panel/lib/syncstate"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ItemIconGroup struct {
}

func (a *ItemIconGroup) Edit(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	req, expectedRevision, ok := bindSyncMutation[models.ItemIconGroup](c)
	if !ok {
		return
	}
	req.UserId = userInfo.ID
	var revision int64
	var stored models.ItemIconGroup
	err := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if req.ID == 0 {
			stored = req
			if err := tx.Create(&stored).Error; err != nil {
				return err
			}
		} else if err := tx.First(&stored, "id = ? AND user_id = ?", req.ID, userInfo.ID).Error; err != nil {
			return err
		}
		var err error
		revision, err = syncstate.MutateTx(tx, syncstate.MutationRequest{AppendRequest: syncstate.AppendRequest{
			UserID: userInfo.ID, ResourceType: models.SyncResourceGroup,
			ResourceID: strconv.FormatUint(uint64(stored.ID), 10), Operation: models.SyncOperationUpsert,
		}, ExpectedRevision: expectedRevision}, func(next int64) (any, error) {
			updates := map[string]any{"icon": req.Icon, "title": req.Title, "description": req.Description, "revision": next}
			if req.Sort != 0 || req.ID == 0 {
				updates["sort"] = req.Sort
			}
			result := tx.Model(&models.ItemIconGroup{}).Where("id = ? AND user_id = ?", stored.ID, userInfo.ID).Updates(updates)
			if result.Error != nil {
				return nil, result.Error
			}
			if err := tx.First(&stored, stored.ID).Error; err != nil {
				return nil, err
			}
			return groupChangePayload(stored), nil
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

func groupChangePayload(group models.ItemIconGroup) map[string]any {
	return map[string]any{
		"id": group.ID, "createTime": group.CreatedAt, "updateTime": group.UpdatedAt,
		"icon": group.Icon, "title": group.Title, "description": group.Description,
		"sort": group.Sort, "revision": strconv.FormatInt(group.Revision, 10), "items": []any{},
	}
}

func (a *ItemIconGroup) GetList(c *gin.Context) {

	userInfo, _ := base.GetCurrentUserInfo(c)
	groups := []models.ItemIconGroup{}

	err := global.Db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Order("sort ,created_at").Where("user_id=?", userInfo.ID).Find(&groups).Error; err != nil {
			apiReturn.ErrorDatabase(c, err.Error())
			return err
		}

		// 判断分组是否为空，为空将自动创建默认分组
		if len(groups) == 0 {
			defaultGroup := models.ItemIconGroup{
				Title:  "APP",
				UserId: userInfo.ID,
				Icon:   "material-symbols:ad-group-outline",
			}
			if err := tx.Create(&defaultGroup).Error; err != nil {
				apiReturn.ErrorDatabase(c, err.Error())
				return err
			}

			// 并将当前账号下所有无分组的图标更新到当前组
			if err := tx.Model(&models.ItemIcon{}).Where("user_id=?", userInfo.ID).Update("item_icon_group_id", defaultGroup.ID).Error; err != nil {
				apiReturn.ErrorDatabase(c, err.Error())
				return err
			}

			groups = append(groups, defaultGroup)
		}

		// 返回 nil 提交事务
		return nil
	})

	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	} else {
		apiReturn.SuccessListData(c, groups, 0)
	}
}

func (a *ItemIconGroup) Deletes(c *gin.Context) {
	req, expectedRevision, ok := bindSyncMutation[commonApiStructs.RequestDeleteIds[uint]](c)
	if !ok {
		return
	}
	userInfo, _ := base.GetCurrentUserInfo(c)
	if len(req.Ids) == 0 {
		apiReturn.ErrorParamFomat(c, "at least one group id is required")
		return
	}

	var count int64
	if err := global.Db.Model(&models.ItemIconGroup{}).Where(" user_id=?", userInfo.ID).Count(&count).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	} else {
		if math.Abs(float64(len(req.Ids))-float64(count)) < 1 {
			apiReturn.ErrorCode(c, 1201, "At least one must be retained", nil)
			return
		}

	}

	var revision int64
	txErr := global.Db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var groups []models.ItemIconGroup
		if err := tx.Where("id in ? AND user_id = ?", req.Ids, userInfo.ID).Find(&groups).Error; err != nil {
			return err
		}
		if len(groups) != len(req.Ids) {
			return gorm.ErrRecordNotFound
		}
		var items []models.ItemIcon
		if err := tx.Where("item_icon_group_id in ? AND user_id = ?", req.Ids, userInfo.ID).Find(&items).Error; err != nil {
			return err
		}
		type deletion struct {
			resourceType, resourceID string
			delete                   func() error
		}
		deletions := make([]deletion, 0, len(items)+len(groups))
		for _, item := range items {
			item := item
			deletions = append(deletions, deletion{models.SyncResourceItem, strconv.FormatUint(uint64(item.ID), 10), func() error {
				return tx.Delete(&models.ItemIcon{}, "id = ? AND user_id = ?", item.ID, userInfo.ID).Error
			}})
		}
		for _, group := range groups {
			group := group
			deletions = append(deletions, deletion{models.SyncResourceGroup, strconv.FormatUint(uint64(group.ID), 10), func() error {
				return tx.Delete(&models.ItemIconGroup{}, "id = ? AND user_id = ?", group.ID, userInfo.ID).Error
			}})
		}
		for index, deletion := range deletions {
			appendRequest := syncstate.AppendRequest{UserID: userInfo.ID, ResourceType: deletion.resourceType,
				ResourceID: deletion.resourceID, Operation: models.SyncOperationDelete}
			mutation := func(int64) (any, error) { return nil, deletion.delete() }
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

	if txErr != nil {
		if errors.Is(txErr, gorm.ErrRecordNotFound) {
			apiReturn.ErrorDataNotFound(c)
			return
		}
		returnSyncMutationError(c, txErr)
		return
	}
	returnSyncMutation(c, revision, nil)
}

// 保存排序
func (a *ItemIconGroup) SaveSort(c *gin.Context) {
	req, expectedRevision, ok := bindSyncMutation[commonApiStructs.SortRequest](c)
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
			var group models.ItemIconGroup
			if err := tx.First(&group, "user_id = ? AND id = ?", userInfo.ID, value.Id).Error; err != nil {
				return err
			}
			appendRequest := syncstate.AppendRequest{UserID: userInfo.ID, ResourceType: models.SyncResourceGroup,
				ResourceID: strconv.FormatUint(uint64(group.ID), 10), Operation: models.SyncOperationUpsert}
			mutation := func(next int64) (any, error) {
				if err := tx.Model(&models.ItemIconGroup{}).Where("id = ? AND user_id = ?", group.ID, userInfo.ID).
					Updates(map[string]any{"sort": value.Sort, "revision": next}).Error; err != nil {
					return nil, err
				}
				group.Sort, group.Revision = int(value.Sort), next
				return groupChangePayload(group), nil
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
