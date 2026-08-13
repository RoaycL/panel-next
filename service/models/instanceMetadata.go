package models

import "time"

const InstanceMetadataID = "instance_id"

// InstanceMetadata stores installation-local identity. It is intentionally
// excluded from logical business backups so a restored server remains distinct.
type InstanceMetadata struct {
	Name      string    `gorm:"type:varchar(64);primaryKey" json:"-"`
	Value     string    `gorm:"type:varchar(128);not null" json:"-"`
	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `json:"-"`
}
