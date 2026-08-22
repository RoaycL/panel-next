package wallhaven

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

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
