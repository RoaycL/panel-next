package system

import (
	"github.com/gin-gonic/gin"
	"net"
	"net/http"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/lib/ratelimit"
)

func accountRateLimit(limiter *ratelimit.FixedWindow) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Do not trust arbitrary X-Forwarded-For headers on public account endpoints.
		peer, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err != nil {
			peer = c.Request.RemoteAddr
		}
		if !limiter.Allow(peer) {
			seconds := int(limiter.RetryAfter(peer).Seconds()) + 1
			apiReturn.ErrorRateLimited(c, seconds)
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		c.Next()
	}
}
