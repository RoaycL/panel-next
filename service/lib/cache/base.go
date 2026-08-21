package cache

import (
	"time"
)

// Cacher 缓存接口，支持 Redis 和内存两种驱动。
type Cacher[T any] interface {
	// Set 设置缓存
	Set(k string, v T, d time.Duration)

	// Get 读取缓存
	Get(k string) (T, bool)

	// SetDefault 设置缓存，过期时间采用默认值
	SetDefault(k string, v T)

	// Delete 删除缓存
	Delete(k string)

	// SetKeepExpiration 设置缓存值，但不重置过期时间
	SetKeepExpiration(k string, v T)

	// ItemCount 缓存项目总数
	ItemCount() (int64, error)

	// Flush 清空缓存
	Flush()
}
