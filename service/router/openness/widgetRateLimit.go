package openness

import (
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/lib/ratelimit"

	"github.com/gin-gonic/gin"
)

// DefaultWidgetLimiter 限制单个客户端 IP 每分钟最多 30 次组件代理请求，
// 覆盖天气与热搜两个公共端点的总入口。
var DefaultWidgetLimiter = ratelimit.NewFixedWindow(30, time.Minute)

// WidgetRateLimit 对公共组件代理端点按客户端 IP 限流，超限时返回 1600 与 Retry-After。
func WidgetRateLimit(limiter *ratelimit.FixedWindow) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if !limiter.Allow(key) {
			retryAfter := int(limiter.RetryAfter(key).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			apiReturn.ErrorRateLimited(c, retryAfter)
			c.Abort()
			return
		}
		c.Next()
	}
}
