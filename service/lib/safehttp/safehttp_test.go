package safehttp

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIsPublicIP(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1"} {
		if IsPublicIP(net.ParseIP(address)) {
			t.Fatalf("%s must not be public", address)
		}
	}
	for _, address := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if !IsPublicIP(net.ParseIP(address)) {
			t.Fatalf("%s must be public", address)
		}
	}
}

func TestClientRefusesHostNamesThatResolveInternally(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("INTERNAL"))
	}))
	defer server.Close()
	target := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
	if _, err := ValidateURL(target); err != nil {
		t.Fatalf("host names are checked at connect time, not rejected up front: %v", err)
	}
	_, err := NewClient(time.Second).Get(target)
	if err == nil || !errors.Is(err, ErrForbiddenAddress) {
		t.Fatalf("internal host was reachable: %v", err)
	}
	if _, err := ValidateURL(server.URL); !errors.Is(err, ErrForbiddenAddress) {
		t.Fatalf("literal loopback address passed validation: %v", err)
	}
}
