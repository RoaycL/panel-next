package models

import "time"

const (
	SessionClientWeb             = "web"
	SessionClientChromeExtension = "chrome_extension"
)

// UserSession represents one revocable client device. Token values are never
// persisted; only SHA-256 hashes are stored for later verification.
type UserSession struct {
	ID               string     `gorm:"type:varchar(36);primaryKey" json:"id"`
	UserID           uint       `gorm:"not null;uniqueIndex:idx_user_session_device,priority:1;index" json:"userId"`
	DeviceID         string     `gorm:"type:varchar(128);not null;uniqueIndex:idx_user_session_device,priority:2" json:"deviceId"`
	DeviceName       string     `gorm:"type:varchar(100);not null" json:"deviceName"`
	ClientType       string     `gorm:"type:varchar(32);not null;uniqueIndex:idx_user_session_device,priority:3;check:client_type IN ('web','chrome_extension')" json:"clientType"`
	AccessTokenHash  string     `gorm:"type:char(64);not null;uniqueIndex" json:"-"`
	RefreshTokenHash string     `gorm:"type:char(64);not null;uniqueIndex" json:"-"`
	RefreshVersion   uint       `gorm:"not null;default:1" json:"-"`
	AccessExpiresAt  time.Time  `gorm:"not null;index" json:"accessExpiresAt"`
	RefreshExpiresAt time.Time  `gorm:"not null;index" json:"refreshExpiresAt"`
	LastActiveAt     time.Time  `gorm:"not null;index" json:"lastActiveAt"`
	RevokedAt        *time.Time `gorm:"index" json:"revokedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// UserSessionRefreshToken records consumed refresh-token hashes. A later use
// of one of these hashes is treated as credential theft and revokes the session.
type UserSessionRefreshToken struct {
	ID        uint      `gorm:"primaryKey" json:"-"`
	SessionID string    `gorm:"type:varchar(36);not null;index" json:"-"`
	TokenHash string    `gorm:"type:char(64);not null;uniqueIndex" json:"-"`
	UsedAt    time.Time `gorm:"not null;index" json:"-"`
	ExpiresAt time.Time `gorm:"not null;index" json:"-"`
}
