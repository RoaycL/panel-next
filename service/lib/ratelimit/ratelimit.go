package ratelimit

import (
	"sync"
	"time"
)

const pruneThreshold = 1024

type windowCounter struct {
	count    int
	expireAt time.Time
}

// FixedWindow 是按 key 独立计数的固定窗口限流器，用于保护公共代理端点。
type FixedWindow struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu       sync.Mutex
	counters map[string]*windowCounter
}

func NewFixedWindow(limit int, window time.Duration) *FixedWindow {
	if limit < 1 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &FixedWindow{
		limit:    limit,
		window:   window,
		now:      time.Now,
		counters: make(map[string]*windowCounter),
	}
}

// Allow 在当前窗口内为 key 增加一次计数；超过限额时返回 false 且不增加计数。
func (limiter *FixedWindow) Allow(key string) bool {
	now := limiter.now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	counter, found := limiter.counters[key]
	if !found || !now.Before(counter.expireAt) {
		limiter.counters[key] = &windowCounter{count: 1, expireAt: now.Add(limiter.window)}
		limiter.pruneLocked(now)
		return true
	}
	if counter.count >= limiter.limit {
		return false
	}
	counter.count++
	return true
}

// RetryAfter 返回 key 当前窗口的剩余时长；未受限时返回 0。
func (limiter *FixedWindow) RetryAfter(key string) time.Duration {
	now := limiter.now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	counter, found := limiter.counters[key]
	if !found || !now.Before(counter.expireAt) || counter.count < limiter.limit {
		return 0
	}
	return counter.expireAt.Sub(now)
}

func (limiter *FixedWindow) pruneLocked(now time.Time) {
	if len(limiter.counters) < pruneThreshold {
		return
	}
	for key, counter := range limiter.counters {
		if !now.Before(counter.expireAt) {
			delete(limiter.counters, key)
		}
	}
}
