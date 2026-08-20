package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"sun-panel/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AccessTokenTTL  = 15 * time.Minute
	RefreshTokenTTL = 30 * 24 * time.Hour
	tokenBytes      = 32
)

// GetRefreshTokenTTL 返回可配置的 Refresh Token 有效期（OPS-02）。
// 从全局配置读取 refresh_token_ttl_hours，默认 168 小时（7 天）。
func GetRefreshTokenTTL() time.Duration {
	// 避免循环引用，通过接口注入
	return defaultRefreshTTL
}

var defaultRefreshTTL = RefreshTokenTTL

// SetRefreshTokenTTL 设置 Refresh Token 有效期（用于配置加载后初始化）。
func SetRefreshTokenTTL(ttl time.Duration) {
	defaultRefreshTTL = ttl
}

var (
	ErrInvalidAccessToken  = errors.New("invalid access token")
	ErrAccessTokenExpired  = errors.New("access token expired")
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrRefreshTokenExpired = errors.New("refresh token expired")
	ErrRefreshTokenReuse   = errors.New("refresh token reuse detected")
	ErrSessionRevoked      = errors.New("session revoked")
	ErrSessionNotFound     = errors.New("session not found")
	ErrInvalidClient       = errors.New("invalid session client")
)

const (
	GinSessionIDKey = "sessionId"
	GinAuthModeKey  = "authMode"
	AuthModeDevice  = "device"
	AuthModeLegacy  = "legacy"
)

type Pair struct {
	AccessToken      string    `json:"accessToken"`
	RefreshToken     string    `json:"refreshToken"`
	AccessExpiresAt  time.Time `json:"accessExpiresAt"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
}

type CreateRequest struct {
	UserID     uint
	DeviceID   string
	DeviceName string
	ClientType string
}

type Device struct {
	ID               string    `json:"id"`
	DeviceID         string    `json:"deviceId"`
	DeviceName       string    `json:"deviceName"`
	ClientType       string    `json:"clientType"`
	LastActiveAt     time.Time `json:"lastActiveAt"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
	CreatedAt        time.Time `json:"createdAt"`
	Current          bool      `json:"current"`
}

type Manager struct {
	DB  *gorm.DB
	Now func() time.Time
}

func NewManager(db *gorm.DB) *Manager {
	return &Manager{DB: db, Now: time.Now}
}

func HashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func newToken() (raw string, hash string, err error) {
	value := make([]byte, tokenBytes)
	if _, err = rand.Read(value); err != nil {
		return "", "", fmt.Errorf("generate session token: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(value)
	return raw, HashToken(raw), nil
}

func (m *Manager) Create(ctx context.Context, request CreateRequest) (models.UserSession, Pair, error) {
	if m == nil || m.DB == nil {
		return models.UserSession{}, Pair{}, errors.New("session database is not initialized")
	}
	if request.UserID == 0 || request.DeviceID == "" || len(request.DeviceID) > 128 || request.DeviceName == "" || len(request.DeviceName) > 100 || !validClientType(request.ClientType) {
		return models.UserSession{}, Pair{}, ErrInvalidClient
	}
	now := m.now()
	pair, accessHash, refreshHash, err := buildPair(now, now.Add(defaultRefreshTTL))
	if err != nil {
		return models.UserSession{}, Pair{}, err
	}
	created := models.UserSession{
		ID: uuid.NewString(), UserID: request.UserID, DeviceID: request.DeviceID,
		DeviceName: request.DeviceName, ClientType: request.ClientType,
		AccessTokenHash: accessHash, RefreshTokenHash: refreshHash, RefreshVersion: 1,
		AccessExpiresAt: pair.AccessExpiresAt, RefreshExpiresAt: pair.RefreshExpiresAt,
		LastActiveAt: now,
	}
	var stored models.UserSession
	err = m.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ? AND device_id = ? AND client_type = ?", request.UserID, request.DeviceID, request.ClientType).
			First(&stored).Error
		if errors.Is(lookup, gorm.ErrRecordNotFound) {
			stored = created
			return tx.Create(&stored).Error
		}
		if lookup != nil {
			return lookup
		}
		if stored.RefreshTokenHash != "" {
			used := models.UserSessionRefreshToken{
				SessionID: stored.ID, TokenHash: stored.RefreshTokenHash,
				UsedAt: now, ExpiresAt: stored.RefreshExpiresAt,
			}
			if err := tx.Create(&used).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&models.UserSession{}).Where("id = ?", stored.ID).Updates(map[string]any{
			"device_name": request.DeviceName, "access_token_hash": accessHash,
			"refresh_token_hash": refreshHash, "access_expires_at": pair.AccessExpiresAt,
			"refresh_expires_at": pair.RefreshExpiresAt, "last_active_at": now,
			"revoked_at": nil, "refresh_version": gorm.Expr("refresh_version + 1"),
		}).Error; err != nil {
			return err
		}
		return tx.First(&stored, "id = ?", stored.ID).Error
	})
	if err != nil {
		return models.UserSession{}, Pair{}, err
	}
	return stored, pair, nil
}

func (m *Manager) AuthenticateAccess(ctx context.Context, rawToken string) (models.UserSession, error) {
	if m == nil || m.DB == nil || rawToken == "" {
		return models.UserSession{}, ErrInvalidAccessToken
	}
	var stored models.UserSession
	if err := m.DB.WithContext(ctx).Where("access_token_hash = ?", HashToken(rawToken)).First(&stored).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.UserSession{}, ErrInvalidAccessToken
		}
		return models.UserSession{}, err
	}
	if stored.RevokedAt != nil {
		return models.UserSession{}, ErrSessionRevoked
	}
	now := m.now()
	if !now.Before(stored.AccessExpiresAt) {
		return models.UserSession{}, ErrAccessTokenExpired
	}
	if err := m.DB.WithContext(ctx).Model(&models.UserSession{}).Where("id = ?", stored.ID).Update("last_active_at", now).Error; err != nil {
		return models.UserSession{}, err
	}
	stored.LastActiveAt = now
	return stored, nil
}

func (m *Manager) RotateRefresh(ctx context.Context, rawToken string) (Pair, error) {
	if m == nil || m.DB == nil || rawToken == "" {
		return Pair{}, ErrInvalidRefreshToken
	}
	hash := HashToken(rawToken)
	now := m.now()
	var pair Pair
	reuseDetected := false
	err := m.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var stored models.UserSession
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("refresh_token_hash = ?", hash).First(&stored).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			var used models.UserSessionRefreshToken
			if historyErr := tx.Where("token_hash = ?", hash).First(&used).Error; historyErr != nil {
				if errors.Is(historyErr, gorm.ErrRecordNotFound) {
					return ErrInvalidRefreshToken
				}
				return historyErr
			}
			reuseDetected = true
			return tx.Model(&models.UserSession{}).Where("id = ? AND revoked_at IS NULL", used.SessionID).Update("revoked_at", now).Error
		}
		if err != nil {
			return err
		}
		if stored.RevokedAt != nil {
			return ErrSessionRevoked
		}
		if !now.Before(stored.RefreshExpiresAt) {
			return ErrRefreshTokenExpired
		}
		var accessHash, refreshHash string
		pair, accessHash, refreshHash, err = buildPair(now, stored.RefreshExpiresAt)
		if err != nil {
			return err
		}
		used := models.UserSessionRefreshToken{
			SessionID: stored.ID, TokenHash: stored.RefreshTokenHash,
			UsedAt: now, ExpiresAt: stored.RefreshExpiresAt,
		}
		if err := tx.Create(&used).Error; err != nil {
			return err
		}
		result := tx.Model(&models.UserSession{}).
			Where("id = ? AND refresh_token_hash = ?", stored.ID, stored.RefreshTokenHash).
			Updates(map[string]any{
				"access_token_hash": accessHash, "refresh_token_hash": refreshHash,
				"access_expires_at": pair.AccessExpiresAt, "last_active_at": now,
				"refresh_version": gorm.Expr("refresh_version + 1"),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvalidRefreshToken
		}
		return nil
	})
	if err != nil {
		return Pair{}, err
	}
	if reuseDetected {
		return Pair{}, ErrRefreshTokenReuse
	}
	return pair, nil
}

func (m *Manager) ListDevices(ctx context.Context, userID uint, currentSessionID string) ([]Device, error) {
	if m == nil || m.DB == nil || userID == 0 {
		return nil, ErrInvalidClient
	}
	var stored []models.UserSession
	if err := m.DB.WithContext(ctx).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Order("last_active_at DESC, created_at DESC").
		Find(&stored).Error; err != nil {
		return nil, err
	}
	devices := make([]Device, 0, len(stored))
	for _, item := range stored {
		devices = append(devices, Device{
			ID: item.ID, DeviceID: item.DeviceID, DeviceName: item.DeviceName,
			ClientType: item.ClientType, LastActiveAt: item.LastActiveAt,
			RefreshExpiresAt: item.RefreshExpiresAt, CreatedAt: item.CreatedAt,
			Current: currentSessionID != "" && item.ID == currentSessionID,
		})
	}
	return devices, nil
}

func (m *Manager) RevokeDevice(ctx context.Context, userID uint, sessionID string) error {
	if m == nil || m.DB == nil || userID == 0 || sessionID == "" {
		return ErrSessionNotFound
	}
	now := m.now()
	result := m.DB.WithContext(ctx).Model(&models.UserSession{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", sessionID, userID).
		Update("revoked_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var count int64
	if err := m.DB.WithContext(ctx).Model(&models.UserSession{}).
		Where("id = ? AND user_id = ?", sessionID, userID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (m *Manager) RevokeAll(ctx context.Context, userID uint) (int64, error) {
	if m == nil || m.DB == nil || userID == 0 {
		return 0, ErrInvalidClient
	}
	result := m.DB.WithContext(ctx).Model(&models.UserSession{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", m.now())
	return result.RowsAffected, result.Error
}

func buildPair(now, refreshExpiresAt time.Time) (Pair, string, string, error) {
	access, accessHash, err := newToken()
	if err != nil {
		return Pair{}, "", "", err
	}
	refresh, refreshHash, err := newToken()
	if err != nil {
		return Pair{}, "", "", err
	}
	accessExpiresAt := now.Add(AccessTokenTTL)
	if refreshExpiresAt.Before(accessExpiresAt) {
		accessExpiresAt = refreshExpiresAt
	}
	pair := Pair{
		AccessToken: access, RefreshToken: refresh,
		AccessExpiresAt: accessExpiresAt, RefreshExpiresAt: refreshExpiresAt,
	}
	return pair, accessHash, refreshHash, nil
}

func validClientType(clientType string) bool {
	return clientType == models.SessionClientWeb || clientType == models.SessionClientChromeExtension
}

func (m *Manager) now() time.Time {
	if m.Now == nil {
		return time.Now().UTC()
	}
	return m.Now().UTC()
}
