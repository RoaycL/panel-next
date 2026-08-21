package syncstate

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func newTestManager(t *testing.T) (*gorm.DB, *Manager) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sync.db")), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.UserSyncState{}, &models.UserSyncChange{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db, NewManager(db)
}

func TestAppendAndListChangesAreAccountScopedAndPaged(t *testing.T) {
	_, manager := newTestManager(t)
	ctx := context.Background()

	first, err := manager.Append(ctx, AppendRequest{
		UserID: 7, ResourceType: models.SyncResourceGroup, ResourceID: "11",
		Operation: models.SyncOperationUpsert, Payload: map[string]any{"title": "Apps"},
	})
	if err != nil || first != 1 {
		t.Fatalf("first revision=%d err=%v", first, err)
	}
	second, err := manager.Append(ctx, AppendRequest{
		UserID: 7, ResourceType: models.SyncResourceItem, ResourceID: "12",
		Operation: models.SyncOperationDelete, Payload: map[string]any{"must": "not leak"},
	})
	if err != nil || second != 2 {
		t.Fatalf("second revision=%d err=%v", second, err)
	}
	other, err := manager.Append(ctx, AppendRequest{
		UserID: 8, ResourceType: models.SyncResourcePanel, ResourceID: "8",
		Operation: models.SyncOperationUpsert, Payload: map[string]any{"private": true},
	})
	if err != nil || other != 1 {
		t.Fatalf("other account revision=%d err=%v", other, err)
	}

	page, err := manager.List(ctx, 7, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if page.FromRevision != 0 || page.NextRevision != 1 || page.CurrentRevision != 2 || !page.HasMore || len(page.Changes) != 1 {
		t.Fatalf("unexpected first page: %+v", page)
	}
	if page.Changes[0].ResourceID != "11" || string(page.Changes[0].Payload) != `{"title":"Apps"}` || page.Changes[0].ChangedAt == "" {
		t.Fatalf("unexpected first change: %+v", page.Changes[0])
	}

	page, err = manager.List(ctx, 7, page.NextRevision, 1)
	if err != nil {
		t.Fatal(err)
	}
	if page.NextRevision != 2 || page.CurrentRevision != 2 || page.HasMore || len(page.Changes) != 1 {
		t.Fatalf("unexpected second page: %+v", page)
	}
	if page.Changes[0].Operation != models.SyncOperationDelete || string(page.Changes[0].Payload) != "null" {
		t.Fatalf("delete change leaked payload: %+v", page.Changes[0])
	}

	otherPage, err := manager.List(ctx, 8, 0, DefaultChangeLimit)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherPage.Changes) != 1 || otherPage.Changes[0].ResourceID != "8" {
		t.Fatalf("account-scoped page is incorrect: %+v", otherPage)
	}
}

func TestListRejectsRevisionAheadAndInvalidInput(t *testing.T) {
	_, manager := newTestManager(t)
	ctx := context.Background()
	if _, err := manager.List(ctx, 7, 1, DefaultChangeLimit); !errors.Is(err, ErrRevisionAhead) {
		t.Fatalf("expected revision-ahead error, got %v", err)
	}
	for _, request := range []AppendRequest{
		{UserID: 0, ResourceType: models.SyncResourcePanel, ResourceID: "7", Operation: models.SyncOperationUpsert},
		{UserID: 7, ResourceType: "unknown", ResourceID: "7", Operation: models.SyncOperationUpsert},
		{UserID: 7, ResourceType: models.SyncResourcePanel, ResourceID: "", Operation: models.SyncOperationUpsert},
		{UserID: 7, ResourceType: models.SyncResourcePanel, ResourceID: "7", Operation: "unknown"},
	} {
		if _, err := manager.Append(ctx, request); !errors.Is(err, ErrInvalidChange) {
			t.Fatalf("expected invalid-change error for %+v, got %v", request, err)
		}
	}
	if _, err := manager.List(ctx, 7, 0, MaximumChangeLimit+1); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("expected invalid limit error, got %v", err)
	}
}

func TestAppendTxRollsBackRevisionAndChangeTogether(t *testing.T) {
	db, manager := newTestManager(t)
	wanted := errors.New("rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		if revision, err := AppendTx(tx, AppendRequest{
			UserID: 7, ResourceType: models.SyncResourcePanel, ResourceID: "7",
			Operation: models.SyncOperationUpsert, Payload: map[string]any{"logoText": "Panel Next"},
		}); err != nil || revision != 1 {
			t.Fatalf("append transaction revision=%d err=%v", revision, err)
		}
		return wanted
	})
	if !errors.Is(err, wanted) {
		t.Fatalf("unexpected transaction error: %v", err)
	}
	page, err := manager.List(context.Background(), 7, 0, DefaultChangeLimit)
	if err != nil {
		t.Fatal(err)
	}
	if page.CurrentRevision != 0 || len(page.Changes) != 0 {
		t.Fatalf("rolled-back sync state remained visible: %+v", page)
	}
}

func TestMutateTxRejectsStaleRevisionAndRollsBackBusinessWrite(t *testing.T) {
	db, manager := newTestManager(t)
	if err := db.AutoMigrate(&models.ItemIconGroup{}); err != nil {
		t.Fatal(err)
	}
	group := models.ItemIconGroup{Title: "Original", UserId: 7}
	if err := db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}

	mutate := func(expected int64, title string) (int64, error) {
		var revision int64
		err := db.Transaction(func(tx *gorm.DB) error {
			var err error
			revision, err = MutateTx(tx, MutationRequest{AppendRequest: AppendRequest{
				UserID: 7, ResourceType: models.SyncResourceGroup, ResourceID: "group",
				Operation: models.SyncOperationUpsert,
			}, ExpectedRevision: expected}, func(next int64) (any, error) {
				result := tx.Model(&models.ItemIconGroup{}).Where("id = ? AND user_id = ?", group.ID, 7).
					Updates(map[string]any{"title": title, "revision": next})
				return map[string]any{"title": title, "revision": next}, result.Error
			})
			return err
		})
		return revision, err
	}

	if revision, err := mutate(0, "First"); err != nil || revision != 1 {
		t.Fatalf("first mutation revision=%d err=%v", revision, err)
	}
	if _, err := mutate(0, "Stale"); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	var stored models.ItemIconGroup
	if err := db.First(&stored, group.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Title != "First" || stored.Revision != 1 {
		t.Fatalf("stale mutation changed resource: %+v", stored)
	}
	page, err := manager.List(context.Background(), 7, 0, DefaultChangeLimit)
	if err != nil || page.CurrentRevision != 1 || len(page.Changes) != 1 {
		t.Fatalf("stale mutation changed sync log: page=%+v err=%v", page, err)
	}
}

func TestMutateTxRollsBackAllocatedRevisionWhenBusinessWriteFails(t *testing.T) {
	db, manager := newTestManager(t)
	wanted := errors.New("business write failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		_, err := MutateTx(tx, MutationRequest{AppendRequest: AppendRequest{
			UserID: 7, ResourceType: models.SyncResourcePanel, ResourceID: "7", Operation: models.SyncOperationUpsert,
		}, ExpectedRevision: 0}, func(int64) (any, error) { return nil, wanted })
		return err
	})
	if !errors.Is(err, wanted) {
		t.Fatalf("unexpected mutation error: %v", err)
	}
	page, err := manager.List(context.Background(), 7, 0, DefaultChangeLimit)
	if err != nil || page.CurrentRevision != 0 || len(page.Changes) != 0 {
		t.Fatalf("failed mutation remained visible: page=%+v err=%v", page, err)
	}
}

func TestConcurrentAppendsAllocateUniqueMonotonicRevisions(t *testing.T) {
	_, manager := newTestManager(t)
	const total = 20
	revisions := make(chan int64, total)
	errorsFound := make(chan error, total)
	for index := 0; index < total; index++ {
		go func(resourceID string) {
			revision, err := manager.Append(context.Background(), AppendRequest{
				UserID: 7, ResourceType: models.SyncResourceItem, ResourceID: resourceID,
				Operation: models.SyncOperationUpsert, Payload: map[string]any{"id": resourceID},
			})
			if err != nil {
				errorsFound <- err
				return
			}
			revisions <- revision
		}(string(rune('A' + index)))
	}
	seen := make(map[int64]bool, total)
	var firstError error
	for completed := 0; completed < total; completed++ {
		select {
		case err := <-errorsFound:
			if firstError == nil {
				firstError = err
			}
		case revision := <-revisions:
			seen[revision] = true
		}
	}
	if firstError != nil {
		t.Fatal(firstError)
	}
	for revision := int64(1); revision <= total; revision++ {
		if !seen[revision] {
			t.Fatalf("missing revision %d from concurrent append set: %+v", revision, seen)
		}
	}
}
