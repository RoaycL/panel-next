package middleware

import (
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"

	"github.com/gin-gonic/gin"
)

func AdminInterceptor(c *gin.Context) {
	currentUser, _ := base.GetCurrentUserInfo(c)
	if currentUser.Role != 1 {
		apiReturn.ErrorNoAccess(c)
		c.Abort()
		return
	}
}
