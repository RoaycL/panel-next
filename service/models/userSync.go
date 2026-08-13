package models

import "time"

const (
	SyncResourcePanel = "panel"
	SyncResourceGroup = "group"
	SyncResourceItem  = "item"

	SyncOperationUpsert = "upsert"
	SyncOperationDelete = "delete"
)

type UserSyncState struct {
	UserID    uint      `gorm:"primaryKey;autoIncrement:false" json:"userId"`
	Revision  int64     `gorm:"not null;default:0" json:"revision"`
	UpdatedAt time.Time `json:"updateTime"`
}

type UserSyncChange struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"-"`
	UserID       uint      `gorm:"not null;uniqueIndex:idx_user_sync_revision,priority:1;index:idx_user_sync_changes_lookup,priority:1" json:"-"`
	Revision     int64     `gorm:"not null;uniqueIndex:idx_user_sync_revision,priority:2;index:idx_user_sync_changes_lookup,priority:2" json:"revision"`
	ResourceType string    `gorm:"type:varchar(20);not null" json:"resourceType"`
	ResourceID   string    `gorm:"type:varchar(64);not null" json:"resourceId"`
	Operation    string    `gorm:"type:varchar(10);not null" json:"operation"`
	PayloadJSON  string    `gorm:"type:text;not null" json:"-"`
	CreatedAt    time.Time `json:"changedAt"`
}
