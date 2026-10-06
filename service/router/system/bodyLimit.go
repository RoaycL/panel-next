package system

import (
	"net/http"

	"panel-next/api/api_v1/common/apiReturn"

	"github.com/gin-gonic/gin"
)

const (
	maxImageUploadBytes = 32 << 20
	maxBatchUploadBytes = 128 << 20
)

// limitRequestBody caps an upload before multipart parsing spools it to disk.
func limitRequestBody(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > limit {
			apiReturn.Error(c, "上传内容过大")
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	}
}
