package cmn

import (
	"strings"
	"testing"
)

func TestPasswordHashAndLegacyCompatibility(t *testing.T) {
	password := " secure-123. "
	one, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	two, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if one == two || !strings.HasPrefix(one, "$2") {
		t.Fatal("password must use distinct salted bcrypt hashes")
	}
	if !VerifyPassword(one, password) || VerifyPassword(one, strings.TrimSpace(password)) || VerifyPassword(one, "incorrect") {
		t.Fatal("password spaces and punctuation must be significant")
	}
	if !VerifyPassword(PasswordEncryption(password), password) {
		t.Fatal("old password hashes must remain usable")
	}
	for _, value := range []string{"short", strings.Repeat("x", 51), "      "} {
		if _, err := HashPassword(value); err == nil {
			t.Fatalf("accepted invalid password %q", value)
		}
	}
}

func TestAccountUsernameRules(t *testing.T) {
	for _, username := range []string{"admin", "alice_01", "foo.bar-2"} {
		if err := ValidateAccountUsername(username); err != nil {
			t.Fatal(err)
		}
	}
	for _, username := range []string{"ab", "admin@example.com", "with space", "-alice", strings.Repeat("a", 33)} {
		if err := ValidateAccountUsername(username); err == nil {
			t.Fatalf("accepted username %q", username)
		}
	}
}
