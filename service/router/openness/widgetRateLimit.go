package openness

import (
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/lib/ratelimit"

	"github.com/gin-gonic/gin"
)

// DefaultWidgetLimiter 限制单个客户端 IP 对每个组件代理端点每分钟最多 30 次请求。
var DefaultWidgetLimiter = ratelimit.NewFixedWindow(30, time.Minute)

// WidgetRateLimit 按客户端 IP + 路由分别限流，避免某个组件耗尽其他组件的额度。
func WidgetRateLimit(limiter *ratelimit.FixedWindow) gin.HandlerFunc {
	return func(c *gin.Context) {
		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}
		key := c.ClientIP() + "|" + route
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
