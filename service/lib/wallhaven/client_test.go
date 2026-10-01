package wallhaven

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAPIKeyHeaderAndCacheIsolation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("apikey") != "" {
			t.Error("credential leaked into URL")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[],"meta":{"current_page":1,"last_page":1,"per_page":24,"total":0}}`))
		if r.Header.Get("X-API-Key") == "" && r.URL.Query().Get("purity") == "111" {
			t.Error("missing credential")
		}
	}))
	defer server.Close()
	client := NewClient(server.Client(), server.URL, time.Minute)
	for _, key := range []string{strings.Repeat("a", 32), strings.Repeat("b", 32)} {
		for attempt := 0; attempt < 2; attempt++ {
			result, err := client.Search(context.Background(), SearchParams{APIKey: key, Purity: "111"})
			if err != nil {
				t.Fatal(err)
			}
			if result.Cached != (attempt == 1) {
				t.Fatal("wrong cache scope")
			}
		}
	}
	if _, err := client.Search(context.Background(), SearchParams{}); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("different users must have separate caches, calls=%d", calls)
	}
	for cacheKey := range client.cache {
		if strings.Contains(cacheKey, strings.Repeat("a", 32)) || strings.Contains(cacheKey, strings.Repeat("b", 32)) {
			t.Fatal("raw credential in cache key")
		}
	}
}

func TestRestrictedContentRequiresAPIKey(t *testing.T) {
	client := NewClient(nil, "http://example.invalid", time.Minute)
	for _, params := range []SearchParams{{Purity: "111"}, {APIKey: "invalid"}} {
		if _, err := client.Search(context.Background(), params); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected credential error, got %v", err)
		}
	}
}

func TestAPIKeyDoesNotFollowRedirect(t *testing.T) {
	redirected := false
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	defer server.Close()
	client := NewClient(server.Client(), server.URL, time.Minute)
	_, err := client.Search(context.Background(), SearchParams{APIKey: strings.Repeat("a", 32)})
	if err == nil || redirected {
		t.Fatal("authenticated redirect must be blocked")
	}
}

func TestSearchRejectsInvalidParamsBeforeNetwork(t *testing.T) {
	client := NewClient(&http.Client{Timeout: time.Second}, "http://127.0.0.1:1", time.Minute)
	_, err := client.Search(context.Background(), SearchParams{Query: strings.Repeat("x", 101)})
	if !errors.Is(err, ErrInvalidParams) {
		t.Fatalf("expected ErrInvalidParams, got %v", err)
	}
	_, err = client.Search(context.Background(), SearchParams{Ratios: "16:9"})
	if !errors.Is(err, ErrInvalidParams) {
		t.Fatalf("invalid ratio was not rejected: %v", err)
	}
}

func TestCachePruningIsBounded(t *testing.T) {
	client := NewClient(nil, "http://example.invalid", time.Minute)
	now := time.Now()
	for index := 0; index < maxCacheEntries+10; index++ {
		client.cache[strconv.Itoa(index)] = cacheEntry{expiresAt: now.Add(time.Minute)}
	}
	client.pruneCacheLocked(now)
	if len(client.cache) >= maxCacheEntries {
		t.Fatalf("cache was not pruned below insertion limit: %d", len(client.cache))
	}
}
