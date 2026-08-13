package syncstate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"sun-panel/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	DefaultChangeLimit  = 200
	MaximumChangeLimit  = 500
	maximumPayloadBytes = 1 << 20
)

var (
	ErrInvalidChange = errors.New("invalid sync change")
	ErrRevisionAhead = errors.New("sync revision is ahead of the server")
)

type Manager struct {
	DB *gorm.DB
}

type AppendRequest struct {
	UserID       uint
	ResourceType string
	ResourceID   string
	Operation    string
	Payload      any
}

type Change struct {
	Revision     int64
	ResourceType string
	ResourceID   string
	Operation    string
	Payload      json.RawMessage
	ChangedAt    string
}

type Page struct {
	FromRevision    int64
	NextRevision    int64
	CurrentRevision int64
	HasMore         bool
	Changes         []Change
}

func NewManager(db *gorm.DB) *Manager {
	return &Manager{DB: db}
}

func (m *Manager) Append(ctx context.Context, request AppendRequest) (int64, error) {
	if m == nil || m.DB == nil {
		return 0, errors.New("sync database is not initialized")
	}
	var revision int64
	err := m.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		revision, err = AppendTx(tx, request)
		return err
	})
	return revision, err
}

func AppendTx(tx *gorm.DB, request AppendRequest) (int64, error) {
	if tx == nil || request.UserID == 0 || !validResourceType(request.ResourceType) ||
		strings.TrimSpace(request.ResourceID) == "" || len(request.ResourceID) > 64 || !validOperation(request.Operation) {
		return 0, ErrInvalidChange
	}
	payload, err := json.Marshal(request.Payload)
	if err != nil || len(payload) > maximumPayloadBytes {
		return 0, ErrInvalidChange
	}
	if request.Operation == models.SyncOperationDelete {
		payload = []byte("null")
	}

	seed := models.UserSyncState{UserID: request.UserID, Revision: 0}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
		return 0, err
	}
	var state models.UserSyncState
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&state, "user_id = ?", request.UserID).Error; err != nil {
		return 0, err
	}
	if state.Revision == math.MaxInt64 {
		return 0, errors.New("sync revision exhausted")
	}
	next := state.Revision + 1
	result := tx.Model(&models.UserSyncState{}).
		Where("user_id = ? AND revision = ?", request.UserID, state.Revision).
		Update("revision", next)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, errors.New("concurrent sync revision update")
	}
	change := models.UserSyncChange{
		UserID: request.UserID, Revision: next, ResourceType: request.ResourceType,
		ResourceID: request.ResourceID, Operation: request.Operation, PayloadJSON: string(payload),
	}
	if err := tx.Create(&change).Error; err != nil {
		return 0, err
	}
	return next, nil
}

func (m *Manager) List(ctx context.Context, userID uint, since int64, limit int) (Page, error) {
	if m == nil || m.DB == nil || userID == 0 || since < 0 {
		return Page{}, ErrInvalidChange
	}
	if limit == 0 {
		limit = DefaultChangeLimit
	}
	if limit < 1 || limit > MaximumChangeLimit {
		return Page{}, ErrInvalidChange
	}
	page := Page{FromRevision: since, NextRevision: since, Changes: make([]Change, 0)}
	var state models.UserSyncState
	err := m.DB.WithContext(ctx).First(&state, "user_id = ?", userID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return Page{}, err
	}
	if err == nil {
		page.CurrentRevision = state.Revision
	}
	if since > page.CurrentRevision {
		return Page{}, ErrRevisionAhead
	}
	var stored []models.UserSyncChange
	if err := m.DB.WithContext(ctx).Where("user_id = ? AND revision > ? AND revision <= ?", userID, since, page.CurrentRevision).
		Order("revision ASC").Limit(limit + 1).Find(&stored).Error; err != nil {
		return Page{}, err
	}
	if len(stored) > limit {
		page.HasMore = true
		stored = stored[:limit]
	}
	for _, item := range stored {
		if !json.Valid([]byte(item.PayloadJSON)) {
			return Page{}, fmt.Errorf("invalid stored sync payload at revision %d", item.Revision)
		}
		page.Changes = append(page.Changes, Change{
			Revision: item.Revision, ResourceType: item.ResourceType, ResourceID: item.ResourceID,
			Operation: item.Operation, Payload: json.RawMessage(item.PayloadJSON), ChangedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
		page.NextRevision = item.Revision
	}
	return page, nil
}

func validResourceType(value string) bool {
	return value == models.SyncResourcePanel || value == models.SyncResourceGroup || value == models.SyncResourceItem
}

func validOperation(value string) bool {
	return value == models.SyncOperationUpsert || value == models.SyncOperationDelete
}
