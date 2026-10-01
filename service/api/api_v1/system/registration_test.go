package system

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"panel-next/global"
	"panel-next/initialize/database"
	"panel-next/lib/cache"
	"panel-next/lib/cmn"
	"panel-next/lib/cmn/systemSetting"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func registrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.InstanceMetadata{}, &models.SystemSetting{}, &models.UserSession{}, &models.UserSessionRefreshToken{}); err != nil {
		t.Fatal(err)
	}
	if err := database.EnsureDefaultSystemSettings(db); err != nil {
		t.Fatal(err)
	}
	oldDB, oldModelsDB, oldSettings := global.Db, models.Db, global.SystemSetting
	oldUserTokens := global.UserToken
	global.UserToken = cache.NewGoCache[models.User](time.Hour, 0)
	global.Db, models.Db = db, db
	global.SystemSetting = &systemSetting.SystemSettingCache{Cache: cache.NewGoCache[interface{}](time.Hour, 0)}
	t.Cleanup(func() {
		global.Db, models.Db, global.SystemSetting = oldDB, oldModelsDB, oldSettings
		global.UserToken = oldUserTokens
	})
	return db
}

func responseCode(t *testing.T, body []byte) int {
	t.Helper()
	var result struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	return result.Code
}

func TestRegisterWithoutEmailAndPrivilegeEscalation(t *testing.T) {
	db := registrationDB(t)
	api := LoginApi{}
	response := callSessionHandler(t, map[string]interface{}{"username": " alice ", "password": "password-123.", "role": 1, "status": 2, "id": 99, "mail": "required-no-longer"}, models.User{}, "", api.Register)
	if responseCode(t, response.Body.Bytes()) != 0 {
		t.Fatalf("register failed: %s", response.Body)
	}
	var user models.User
	if err := db.First(&user, "username = ?", "alice").Error; err != nil {
		t.Fatal(err)
	}
	if user.Role != 2 || user.Status != 1 || user.Mail != "" || user.Name != "alice" || user.ID == 99 || !cmn.VerifyPassword(user.Password, "password-123.") {
		t.Fatalf("unsafe registered user: %+v", user)
	}
	if strings.Contains(response.Body.String(), "password-123") || strings.Contains(response.Body.String(), "$2") {
		t.Fatal("password leaked in registration response")
	}
	response = callSessionHandler(t, map[string]string{"username": "alice", "password": "password-123."}, models.User{}, "", api.Register)
	if responseCode(t, response.Body.Bytes()) != 1701 {
		t.Fatalf("duplicate accepted: %s", response.Body)
	}
	response = callSessionHandler(t, map[string]string{"username": "alice", "password": "password-123.", "deviceId": "test-browser", "deviceName": "Test", "clientType": "web"}, models.User{}, "", api.SessionLogin)
	if responseCode(t, response.Body.Bytes()) != 0 {
		t.Fatalf("registered account cannot log in: %s", response.Body)
	}
}

func TestRegisterDisabledAndInputValidation(t *testing.T) {
	registrationDB(t)
	api := LoginApi{}
	for _, input := range []map[string]string{
		{"username": "a@b.com", "password": "password-123"},
		{"username": "bob", "password": "123"},
		{"username": "bob", "password": strings.Repeat("p", 51)},
		{"username": "bob", "password": "       "},
	} {
		response := callSessionHandler(t, input, models.User{}, "", api.Register)
		if responseCode(t, response.Body.Bytes()) == 0 {
			t.Fatalf("accepted invalid registration: %#v", input)
		}
	}
	response := callSessionHandler(t, map[string]bool{"openRegister": false}, models.User{}, "", api.AccountSettingsSet)
	if responseCode(t, response.Body.Bytes()) != 0 {
		t.Fatalf("cannot close registration: %s", response.Body)
	}
	response = callSessionHandler(t, map[string]string{"username": "bob", "password": "password-123"}, models.User{}, "", api.Register)
	if responseCode(t, response.Body.Bytes()) != 1700 {
		t.Fatalf("closed registration accepted: %s", response.Body)
	}
}

func TestLegacyAccountPasswordUpgrade(t *testing.T) {
	db := registrationDB(t)
	legacy := cmn.PasswordEncryption("legacy-pass.")
	user := models.User{Username: "old@example.com", Password: legacy, Status: 1, Role: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := user.Authenticate(user.Username, "wrong"); err == nil {
		t.Fatal("incorrect password accepted")
	}
	var stored models.User
	if err := db.First(&stored, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Password != legacy {
		t.Fatal("bad login modified password")
	}
	if _, err := user.Authenticate(user.Username, "legacy-pass."); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&stored, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored.Password, "$2") || !cmn.VerifyPassword(stored.Password, "legacy-pass.") {
		t.Fatal("legacy hash did not upgrade")
	}
	if stored.Username != user.Username {
		t.Fatal("existing username was changed")
	}
}

func TestOptionalProfileEmailAndPasswordChanges(t *testing.T) {
	db := registrationDB(t)
	hash, err := cmn.HashPassword("password-123.")
	if err != nil {
		t.Fatal(err)
	}
	first := models.User{Username: "alice", Name: "Alice", Password: hash, Status: 1, Role: 2}
	second := models.User{Username: "bob", Name: "Bob", Password: hash, Status: 1, Role: 2}
	for _, user := range []*models.User{&first, &second} {
		if _, err := user.CreateOne(); err != nil {
			t.Fatal(err)
		}
		response := callSessionHandler(t, map[string]string{"name": "A", "mail": "", "headImage": ""}, *user, "", (&UserApi{}).UpdateInfo)
		if responseCode(t, response.Body.Bytes()) != 0 {
			t.Fatalf("optional empty email blocked profile save: %s", response.Body)
		}
	}
	_, pair, err := sessionlib.NewManager(db).Create(context.Background(), sessionlib.CreateRequest{UserID: first.ID, DeviceID: "test-password", DeviceName: "Test", ClientType: models.SessionClientWeb})
	if err != nil {
		t.Fatal(err)
	}
	response := callSessionHandler(t, map[string]string{"oldPassword": "password-123.", "newPassword": "new-password-123."}, first, "", (&UserApi{}).UpdatePasssword)
	if responseCode(t, response.Body.Bytes()) != 0 {
		t.Fatalf("cannot update bcrypt password: %s", response.Body)
	}
	if _, err := first.Authenticate(first.Username, "new-password-123."); err != nil {
		t.Fatal(err)
	}
	if _, err := first.Authenticate(first.Username, "password-123."); err == nil {
		t.Fatal("old password still authenticates")
	}
	if _, err := sessionlib.NewManager(db).AuthenticateAccess(context.Background(), pair.AccessToken); err == nil {
		t.Fatal("password change did not revoke device session")
	}
}
