package system

import (
	"encoding/json"
	"strconv"

	"panel-next/lib/syncstate"
	"panel-next/models"
	"panel-next/models/datatype"

	"gorm.io/gorm"
)

// Keep this first-run set aligned with featuredSiteIds in the extension UI.
// All marks are bundled text/vector icons, so no remote favicon is required.
var extensionStarterBookmarks = []struct {
	title, url, mark, color string
	iconType                int
}{
	{"百度", "https://www.baidu.com", "百", "#315bd6", 1},
	{"Google", "https://www.google.com", "G", "#ffffff", 1},
	{"Bing", "https://www.bing.com", "B", "#0c827b", 1},
	{"GitHub", "https://github.com", "mdi:github", "#303640", 3},
	{"哔哩哔哩", "https://www.bilibili.com", "ri:bilibili-fill", "#ed6a9a", 3},
	{"YouTube", "https://www.youtube.com", "ri:youtube-fill", "#ed4040", 3},
	{"ChatGPT", "https://chatgpt.com", "mdi:robot", "#16836c", 3},
	{"Cloudflare", "https://dash.cloudflare.com", "CF", "#ee7623", 1},
	{"Docker Hub", "https://hub.docker.com", "mdi:docker", "#2675db", 3},
	{"V2EX", "https://www.v2ex.com", "mdi:code-tags", "#4a5e72", 3},
	{"Claude", "https://claude.ai", "C", "#bf8061", 1},
	{"DeepSeek", "https://chat.deepseek.com", "solar:cpu-bold", "#4673db", 3},
}

// Seed only a genuinely untouched dashboard. A user who deleted all icons has
// item change history, so an empty dashboard remains intentionally empty.
func seedExtensionStarterBookmarks(tx *gorm.DB, userID uint, groups []models.ItemIconGroup) error {
	if len(groups) != 1 || groups[0].Title != "APP" || groups[0].Revision != 0 {
		return nil
	}
	var itemCount, editedCount int64
	if err := tx.Model(&models.ItemIcon{}).Where("user_id = ?", userID).Count(&itemCount).Error; err != nil {
		return err
	}
	if itemCount != 0 {
		return nil
	}
	if err := tx.Model(&models.UserSyncChange{}).
		Where("user_id = ? AND resource_type IN ?", userID, []string{models.SyncResourceItem, models.SyncResourceGroup}).
		Count(&editedCount).Error; err != nil {
		return err
	}
	if editedCount != 0 {
		return nil
	}

	for index, preset := range extensionStarterBookmarks {
		icon := datatype.ItemIconIconInfo{ItemType: preset.iconType, Text: preset.mark, BackgroundColor: preset.color}
		iconJSON, err := json.Marshal(icon)
		if err != nil {
			return err
		}
		item := models.ItemIcon{
			UserId: userID, ItemIconGroupId: int(groups[0].ID), Title: preset.title,
			Url: preset.url, Description: preset.url, OpenMethod: 1, Sort: index + 1,
			Icon: icon, IconJson: string(iconJSON),
		}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		_, err = syncstate.ContinueMutationTx(tx, syncstate.AppendRequest{
			UserID: userID, ResourceType: models.SyncResourceItem,
			ResourceID: strconv.FormatUint(uint64(item.ID), 10), Operation: models.SyncOperationUpsert,
		}, func(revision int64) (any, error) {
			if err := tx.Model(&item).Update("revision", revision).Error; err != nil {
				return nil, err
			}
			if err := tx.First(&item, item.ID).Error; err != nil {
				return nil, err
			}
			return map[string]any{
				"id": item.ID, "createTime": item.CreatedAt, "updateTime": item.UpdatedAt,
				"icon": icon, "title": item.Title, "url": item.Url, "lanUrl": "",
				"description": item.Description, "openMethod": item.OpenMethod, "sort": item.Sort,
				"revision": strconv.FormatInt(revision, 10), "itemIconGroupId": item.ItemIconGroupId,
			}, nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
