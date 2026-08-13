package session

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sun-panel/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func testManager(t *testing.T) (*Manager, *time.Time) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	manager := NewManager(db)
	manager.Now = func() time.Time { return now }
	return manager, &now
}

func TestSessionSurvivesServiceRestart(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "sessions.db")
	firstDB, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := firstDB.AutoMigrate(&models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	firstManager := NewManager(firstDB)
	firstManager.Now = func() time.Time { return now }
	stored, pair, err := firstManager.Create(context.Background(), CreateRequest{
		UserID: 10, DeviceID: "restart-browser", DeviceName: "Persistent browser", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := firstDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}

	secondDB, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if reopened, dbErr := secondDB.DB(); dbErr == nil {
			_ = reopened.Close()
		}
	})
	secondManager := NewManager(secondDB)
	secondManager.Now = func() time.Time { return now.Add(time.Minute) }
	authenticated, err := secondManager.AuthenticateAccess(context.Background(), pair.AccessToken)
	if err != nil || authenticated.ID != stored.ID {
		t.Fatalf("persisted access token failed after restart: session=%q err=%v", authenticated.ID, err)
	}
	rotated, err := secondManager.RotateRefresh(context.Background(), pair.RefreshToken)
	if err != nil {
		t.Fatalf("persisted refresh token failed after restart: %v", err)
	}
	if _, err := secondManager.AuthenticateAccess(context.Background(), rotated.AccessToken); err != nil {
		t.Fatalf("rotated access token failed after restart: %v", err)
	}
}

func TestCreateAndAuthenticateStoresOnlyHashes(t *testing.T) {
	manager, _ := testManager(t)
	stored, pair, err := manager.Create(context.Background(), CreateRequest{
		UserID: 3, DeviceID: "browser-1", DeviceName: "Laptop", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(pair.AccessToken) < 40 || len(pair.RefreshToken) < 40 {
		t.Fatal("issued tokens do not contain enough entropy")
	}
	if stored.AccessTokenHash == pair.AccessToken || stored.RefreshTokenHash == pair.RefreshToken {
		t.Fatal("plaintext token was persisted")
	}
	if stored.AccessTokenHash != HashToken(pair.AccessToken) || stored.RefreshTokenHash != HashToken(pair.RefreshToken) {
		t.Fatal("stored token hashes do not match issued tokens")
	}
	authenticated, err := manager.AuthenticateAccess(context.Background(), pair.AccessToken)
	if err != nil || authenticated.ID != stored.ID {
		t.Fatalf("authenticate access token: session=%q err=%v", authenticated.ID, err)
	}
	var dump strings.Builder
	if err := manager.DB.Model(&models.UserSession{}).Select("access_token_hash", "refresh_token_hash").Row().Scan(&stored.AccessTokenHash, &stored.RefreshTokenHash); err != nil {
		t.Fatal(err)
	}
	dump.WriteString(stored.AccessTokenHash)
	dump.WriteString(stored.RefreshTokenHash)
	if strings.Contains(dump.String(), pair.AccessToken) || strings.Contains(dump.String(), pair.RefreshToken) {
		t.Fatal("database row contains a plaintext token")
	}
}

func TestReauthenticationRotatesExistingDevice(t *testing.T) {
	manager, now := testManager(t)
	first, firstPair, err := manager.Create(context.Background(), CreateRequest{
		UserID: 9, DeviceID: "stable-browser", DeviceName: "Old name", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	second, secondPair, err := manager.Create(context.Background(), CreateRequest{
		UserID: 9, DeviceID: "stable-browser", DeviceName: "New name", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.DeviceName != "New name" || second.RefreshVersion != first.RefreshVersion+1 {
		t.Fatalf("device session was not rotated in place: first=%+v second=%+v", first, second)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), firstPair.AccessToken); !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("old access token survived reauthentication: %v", err)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), secondPair.AccessToken); err != nil {
		t.Fatalf("new access token failed: %v", err)
	}
	if _, err := manager.RotateRefresh(context.Background(), firstPair.RefreshToken); !errors.Is(err, ErrRefreshTokenReuse) {
		t.Fatalf("old refresh token reuse was not detected: %v", err)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), secondPair.AccessToken); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("replayed old refresh did not revoke replacement session: %v", err)
	}
}

func TestRefreshRotationAndReuseRevokesSession(t *testing.T) {
	manager, now := testManager(t)
	stored, first, err := manager.Create(context.Background(), CreateRequest{
		UserID: 4, DeviceID: "extension-1", DeviceName: "Chrome", ClientType: models.SessionClientChromeExtension,
	})
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	second, err := manager.RotateRefresh(context.Background(), first.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if second.RefreshToken == first.RefreshToken || second.AccessToken == first.AccessToken {
		t.Fatal("rotation returned an existing token")
	}
	if _, err := manager.AuthenticateAccess(context.Background(), first.AccessToken); !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("old access token should be invalid after rotation, got %v", err)
	}
	if _, err := manager.RotateRefresh(context.Background(), first.RefreshToken); !errors.Is(err, ErrRefreshTokenReuse) {
		t.Fatalf("expected refresh reuse detection, got %v", err)
	}
	var revoked models.UserSession
	if err := manager.DB.First(&revoked, "id = ?", stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revoked.RevokedAt == nil {
		t.Fatal("session was not revoked after refresh-token reuse")
	}
	if _, err := manager.AuthenticateAccess(context.Background(), second.AccessToken); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("rotated access token should be revoked, got %v", err)
	}
}

func TestConcurrentRefreshHasOneWinnerAndRevokesOnReuse(t *testing.T) {
	manager, _ := testManager(t)
	stored, first, err := manager.Create(context.Background(), CreateRequest{
		UserID: 13, DeviceID: "concurrent-extension", DeviceName: "Chrome", ClientType: models.SessionClientChromeExtension,
	})
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		pair Pair
		err  error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			pair, rotateErr := manager.RotateRefresh(context.Background(), first.RefreshToken)
			results <- result{pair: pair, err: rotateErr}
		}()
	}
	close(start)

	successes, reuses := 0, 0
	var successor Pair
	for i := 0; i < 2; i++ {
		outcome := <-results
		switch {
		case outcome.err == nil:
			successes++
			successor = outcome.pair
		case errors.Is(outcome.err, ErrRefreshTokenReuse):
			reuses++
		default:
			t.Fatalf("unexpected concurrent refresh error: %v", outcome.err)
		}
	}
	if successes != 1 || reuses != 1 {
		t.Fatalf("concurrent refresh outcomes: successes=%d reuses=%d", successes, reuses)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), successor.AccessToken); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("reused refresh token did not revoke its concurrent successor: %v", err)
	}
	var refreshed models.UserSession
	if err := manager.DB.First(&refreshed, "id = ?", stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.RevokedAt == nil || refreshed.RefreshVersion != 2 {
		t.Fatalf("unexpected concurrent refresh state: %+v", refreshed)
	}
}

func TestTokenExpiry(t *testing.T) {
	manager, now := testManager(t)
	_, pair, err := manager.Create(context.Background(), CreateRequest{
		UserID: 5, DeviceID: "browser-2", DeviceName: "Desktop", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(AccessTokenTTL)
	if _, err := manager.AuthenticateAccess(context.Background(), pair.AccessToken); !errors.Is(err, ErrAccessTokenExpired) {
		t.Fatalf("expected access expiry, got %v", err)
	}
	*now = now.Add(RefreshTokenTTL)
	if _, err := manager.RotateRefresh(context.Background(), pair.RefreshToken); !errors.Is(err, ErrRefreshTokenExpired) {
		t.Fatalf("expected refresh expiry, got %v", err)
	}
}

func TestRotationDoesNotExtendAbsoluteExpiry(t *testing.T) {
	manager, now := testManager(t)
	_, first, err := manager.Create(context.Background(), CreateRequest{
		UserID: 6, DeviceID: "browser-3", DeviceName: "Tablet", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	*now = first.RefreshExpiresAt.Add(-time.Minute)
	second, err := manager.RotateRefresh(context.Background(), first.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if !second.RefreshExpiresAt.Equal(first.RefreshExpiresAt) {
		t.Fatal("refresh rotation extended the absolute expiry")
	}
	if !second.AccessExpiresAt.Equal(first.RefreshExpiresAt) {
		t.Fatal("access token outlived the refresh session")
	}
}

func TestListAndRevokeDevicesAreScopedToUser(t *testing.T) {
	manager, now := testManager(t)
	first, firstPair, err := manager.Create(context.Background(), CreateRequest{
		UserID: 7, DeviceID: "web-1", DeviceName: "Laptop", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	second, _, err := manager.Create(context.Background(), CreateRequest{
		UserID: 7, DeviceID: "extension-1", DeviceName: "Chrome", ClientType: models.SessionClientChromeExtension,
	})
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := manager.Create(context.Background(), CreateRequest{
		UserID: 8, DeviceID: "web-1", DeviceName: "Other", ClientType: models.SessionClientWeb,
	})
	if err != nil {
		t.Fatal(err)
	}

	devices, err := manager.ListDevices(context.Background(), 7, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 2 || devices[0].ID != second.ID || !devices[0].Current || devices[1].Current {
		t.Fatalf("unexpected device list: %+v", devices)
	}
	if err := manager.RevokeDevice(context.Background(), 7, other.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("cross-user revoke should be hidden as not found, got %v", err)
	}
	if _, err := manager.AuthenticateAccess(context.Background(), firstPair.AccessToken); err != nil {
		t.Fatalf("cross-user revoke affected own session: %v", err)
	}
	if err := manager.RevokeDevice(context.Background(), 7, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.RevokeDevice(context.Background(), 7, first.ID); err != nil {
		t.Fatalf("revoke should be idempotent: %v", err)
	}
	count, err := manager.RevokeAll(context.Background(), 7)
	if err != nil || count != 1 {
		t.Fatalf("revoke all: count=%d err=%v", count, err)
	}
	devices, err = manager.ListDevices(context.Background(), 7, "")
	if err != nil || len(devices) != 0 {
		t.Fatalf("revoked devices should not be listed: %+v err=%v", devices, err)
	}
	otherDevices, err := manager.ListDevices(context.Background(), 8, "")
	if err != nil || len(otherDevices) != 1 || otherDevices[0].ID != other.ID {
		t.Fatalf("revoke all crossed user boundary: %+v err=%v", otherDevices, err)
	}
}
