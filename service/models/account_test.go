package models

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestConcurrentAccountCreation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "accounts.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&User{}, &InstanceMetadata{}); err != nil {
		t.Fatal(err)
	}
	previous := Db
	Db = db
	t.Cleanup(func() { Db = previous })
	var success int32
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			user := User{Username: "alice", Password: "test-hash", Role: 2, Status: 1}
			if _, err := user.CreateOne(); err == nil {
				atomic.AddInt32(&success, 1)
			}
		}()
	}
	workers.Wait()
	var count int64
	if err := db.Model(&User{}).Where("username = ?", "alice").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if success != 1 || count != 1 {
		t.Fatalf("concurrent duplicate accounts: success=%d count=%d", success, count)
	}
}
