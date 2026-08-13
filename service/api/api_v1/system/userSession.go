package system

import (
	"errors"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"

	"github.com/gin-gonic/gin"
)

type UserSessionApi struct{}

func (a *UserSessionApi) GetList(c *gin.Context) {
	user, _ := base.GetCurrentUserInfo(c)
	currentSessionID, _ := c.Get(sessionlib.GinSessionIDKey)
	current, _ := currentSessionID.(string)
	devices, err := sessionlib.NewManager(global.Db).ListDevices(c.Request.Context(), user.ID, current)
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessListData(c, devices, int64(len(devices)))
}

func (a *UserSessionApi) Revoke(c *gin.Context) {
	var request struct {
		SessionID string `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.SessionID == "" {
		if err != nil {
			apiReturn.ErrorParamFomat(c, err.Error())
		} else {
			apiReturn.ErrorParamFomat(c, "sessionId is required")
		}
		return
	}
	user, _ := base.GetCurrentUserInfo(c)
	err := sessionlib.NewManager(global.Db).RevokeDevice(c.Request.Context(), user.ID, request.SessionID)
	if errors.Is(err, sessionlib.ErrSessionNotFound) {
		apiReturn.ErrorDataNotFound(c)
		return
	}
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.Success(c)
}

func (a *UserSessionApi) RevokeAll(c *gin.Context) {
	user, _ := base.GetCurrentUserInfo(c)
	count, err := sessionlib.NewManager(global.Db).RevokeAll(c.Request.Context(), user.ID)
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, gin.H{"revokedCount": count})
}
