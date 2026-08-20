package ratelimit

import (
	"sync"
	"testing"
	"time"
)

func TestFixedWindowAllowsLimitThenBlocks(t *testing.T) {
	now := time.Now()
	limiter := NewFixedWindow(3, time.Minute)
	limiter.now = func() time.Time { return now }

	for call := 0; call < 3; call++ {
		if !limiter.Allow("1.2.3.4") {
			t.Fatalf("call %d within limit was rejected", call+1)
		}
	}
	if limiter.Allow("1.2.3.4") {
		t.Fatal("request over the limit was allowed")
	}
	if limiter.Allow("1.2.3.4") {
		t.Fatal("repeated over-limit request was allowed")
	}

	// 其他 key 不受影响
	if !limiter.Allow("5.6.7.8") {
		t.Fatal("unrelated key was rejected")
	}
}

func TestFixedWindowResetsAfterWindow(t *testing.T) {
	now := time.Now()
	limiter := NewFixedWindow(2, time.Minute)
	limiter.now = func() time.Time { return now }

	if !limiter.Allow("client") || !limiter.Allow("client") {
		t.Fatal("requests within limit were rejected")
	}
	if limiter.Allow("client") {
		t.Fatal("request over the limit was allowed")
	}

	now = now.Add(61 * time.Second)
	if !limiter.Allow("client") {
		t.Fatal("request after window reset was rejected")
	}
}

func TestFixedWindowRetryAfter(t *testing.T) {
	now := time.Now()
	limiter := NewFixedWindow(1, time.Minute)
	limiter.now = func() time.Time { return now }

	if remaining := limiter.RetryAfter("client"); remaining != 0 {
		t.Fatalf("unlimited key reported retry-after %v", remaining)
	}
	if !limiter.Allow("client") {
		t.Fatal("first request was rejected")
	}
	remaining := limiter.RetryAfter("client")
	if remaining <= 0 || remaining > time.Minute {
		t.Fatalf("unexpected retry-after %v", remaining)
	}
	if limiter.Allow("client") {
		t.Fatal("second request was allowed")
	}
}

func TestFixedWindowPrunesExpiredCounters(t *testing.T) {
	now := time.Now()
	limiter := NewFixedWindow(1, time.Minute)
	limiter.now = func() time.Time { return now }

	for index := 0; index < pruneThreshold; index++ {
		limiter.Allow(string(rune('a'+index%26)) + time.Duration(index).String())
	}
	if len(limiter.counters) < pruneThreshold {
		t.Fatalf("expected at least %d counters, got %d", pruneThreshold, len(limiter.counters))
	}

	now = now.Add(2 * time.Minute)
	limiter.Allow("trigger-prune")
	limiter.mu.Lock()
	remaining := len(limiter.counters)
	limiter.mu.Unlock()
	if remaining > 2 {
		t.Fatalf("expected expired counters to be pruned, %d remain", remaining)
	}
}

func TestFixedWindowConcurrentAllowsEnforceLimit(t *testing.T) {
	limiter := NewFixedWindow(10, time.Minute)
	var allowed sync.Map
	var wg sync.WaitGroup
	for index := 0; index < 50; index++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			if limiter.Allow("concurrent") {
				allowed.Store(id, true)
			}
		}(index)
	}
	wg.Wait()
	count := 0
	allowed.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count != 10 {
		t.Fatalf("expected exactly 10 allowed requests, got %d", count)
	}
}
