package captcha

import (
	"errors"
	"sync"
	"time"

	"panel-next/global"

	"github.com/gin-gonic/gin"
	"github.com/mojocn/base64Captcha"
)

var Store = base64Captcha.DefaultMemStore

// CaptchaConfig 验证码配置。
type CaptchaConfig struct {
	Enabled        bool          // 是否启用
	MaxFailCount   int           // 最大失败次数（0 表示不限制）
	LockDuration   time.Duration // 失败锁定时长（0 表示不锁定）
	ExpireDuration time.Duration // 验证码过期时长
	Width          int           // 图片宽度
	Height         int           // 图片高度
}

var defaultConfig = CaptchaConfig{
	Enabled:        false,
	MaxFailCount:   5,
	LockDuration:   10 * time.Minute,
	ExpireDuration: 5 * time.Minute,
	Width:          150,
	Height:         50,
}

// FailRecord 记录失败尝试。
type FailRecord struct {
	Count       int
	LockedAt    time.Time
	LockedUntil time.Time
}

var (
	failRecords = make(map[string]*FailRecord)
	failMu      sync.RWMutex
)

// SetConfig 设置验证码配置。
func SetConfig(cfg CaptchaConfig) {
	defaultConfig = cfg
}

// GetConfig 返回当前验证码配置。
func GetConfig() CaptchaConfig {
	return defaultConfig
}

func checkFailRecord(captchaId string) error {
	failMu.RLock()
	record, exists := failRecords[captchaId]
	failMu.RUnlock()
	if !exists {
		return nil
	}
	now := time.Now()
	if now.Before(record.LockedUntil) {
		return ErrLocked
	}
	return nil
}

func recordFail(captchaId string) {
	failMu.Lock()
	defer failMu.Unlock()
	record, exists := failRecords[captchaId]
	if !exists {
		failRecords[captchaId] = &FailRecord{Count: 1}
		return
	}
	record.Count++
	if defaultConfig.MaxFailCount > 0 && record.Count >= defaultConfig.MaxFailCount && record.LockedUntil.IsZero() {
		now := time.Now()
		record.LockedAt = now
		record.LockedUntil = now.Add(defaultConfig.LockDuration)
	}
}

func clearFail(captchaId string) {
	failMu.Lock()
	defer failMu.Unlock()
	delete(failRecords, captchaId)
}

// GetFailCount 返回某个 captchaId 的失败次数。
func GetFailCount(captchaId string) int {
	failMu.RLock()
	defer failMu.RUnlock()
	if record, exists := failRecords[captchaId]; exists {
		return record.Count
	}
	return 0
}

// IsLocked 返回某个 captchaId 是否被锁定。
func IsLocked(captchaId string) bool {
	failMu.RLock()
	defer failMu.RUnlock()
	record, exists := failRecords[captchaId]
	if !exists {
		return false
	}
	return time.Now().Before(record.LockedUntil)
}

var (
	// ErrLocked 失败次数过多导致锁定。
	ErrLocked = errors.New("captcha locked due to too many failures")
	// ErrExpired 验证码已过期。
	ErrExpired = errors.New("captcha expired")
)

// NewDriver 创建验证码驱动。
func NewDriver(width, height int) *base64Captcha.DriverString {
	driver := new(base64Captcha.DriverString)
	driver.Height = height
	driver.Width = width
	driver.NoiseCount = 0
	driver.ShowLineOptions = base64Captcha.OptionShowSlimeLine | base64Captcha.OptionShowHollowLine
	driver.Length = 4
	driver.Source = "1234567890qwertyuipkjhgfdsazxcvbnm"
	driver.Fonts = []string{"wqy-microhei.ttc"}
	return driver
}

// GenerateCaptchaHandler 生成并返回 Base64 编码的验证码图片。
func GenerateCaptchaHandler(id string, width, height int) string {
	var driver = NewDriver(width, height).ConvertFonts()
	c := base64Captcha.NewCaptcha(driver, Store)
	_, content, answer := c.Driver.GenerateIdQuestionAnswer()

	item, _ := c.Driver.DrawCaptcha(content)
	c.Store.Set(id, answer)
	return item.EncodeB64string()
}

// CaptchaVerifyHandle 验证验证码，同时处理失败计数和锁定。
func CaptchaVerifyHandle(id, vcode string) bool {
	if err := checkFailRecord(id); err != nil {
		global.Logger.Warnf("captcha locked for %s: %v", id, err)
		return false
	}
	if !Store.Verify(id, vcode, true) {
		recordFail(id)
		return false
	}
	clearFail(id)
	return true
}

// CaptchaGetIdByCookieHeader 从 Cookie 或 Header 获取验证码 ID。
func CaptchaGetIdByCookieHeader(c *gin.Context, key string) (captchaId string, err error) {
	captchaId, err = c.Cookie("CaptchaId")
	if err != nil {
		global.Logger.Errorf("failed to get captchaId from cookie, err:%+v\n", err)
		return captchaId, err
	}
	if captchaId == "" {
		captchaId = c.GetHeader(key)
	}
	return
}
