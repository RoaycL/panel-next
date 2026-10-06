package cmn

import (
	"crypto/subtle"
	"errors"
	"regexp"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

const DefaultAdminUsername = "admin"
const DefaultAdminPassword = "admin123"

var accountUsernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$`)

func ValidateAccountUsername(username string) error {
	if !accountUsernamePattern.MatchString(username) {
		return errors.New("用户名须为 3–32 位字母、数字、下划线、点或短横线，且以字母或数字开头")
	}
	return nil
}

func HashPassword(password string) (string, error) {
	if len(password) < 6 || len(password) > 50 {
		return "", errors.New("密码须为 6–50 字节，不能全为空白")
	}
	if strings.TrimSpace(password) == "" {
		return "", errors.New("密码不能全为空白")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

// Existing weak passwords remain usable but no longer need an unsalted MD5 hash.
// bcrypt rejects inputs over 72 bytes; never silently truncate old credentials.
func UpgradeLegacyPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

// Old accounts keep their credentials; successful logins upgrade legacy hashes.
func VerifyPassword(hash, password string) bool {
	if strings.HasPrefix(hash, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
	}
	return len(hash) == 32 && subtle.ConstantTimeCompare([]byte(hash), []byte(PasswordEncryption(password))) == 1
}

var defaultPasswordHashes sync.Map

// IsDefaultPassword reports whether a stored hash still matches the factory
// admin password. bcrypt is slow, so results are memoized per hash: a new hash
// appears only when the password changes.
func IsDefaultPassword(hash string) bool {
	if hash == "" {
		return false
	}
	if cached, ok := defaultPasswordHashes.Load(hash); ok {
		return cached.(bool)
	}
	matches := VerifyPassword(hash, DefaultAdminPassword)
	defaultPasswordHashes.Store(hash, matches)
	return matches
}
