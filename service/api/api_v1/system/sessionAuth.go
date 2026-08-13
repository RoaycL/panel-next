package system

import (
	"errors"
	"strings"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/models"

	"github.com/gin-gonic/gin"
)

type sessionLoginRequest struct {
	LoginLoginVerify
	DeviceID   string `json:"deviceId" validate:"required,max=128"`
	DeviceName string `json:"deviceName" validate:"required,max=100"`
	ClientType string `json:"clientType" validate:"required"`
}

type sessionUser struct {
	ID        uint   `json:"id"`
	UserID    uint   `json:"userId"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	HeadImage string `json:"headImage"`
	Role      int    `json:"role"`
	Mail      string `json:"mail"`
	Status    int    `json:"status"`
}

func (l LoginApi) SessionLogin(c *gin.Context) {
	request := sessionLoginRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	request.DeviceID = strings.TrimSpace(request.DeviceID)
	request.DeviceName = strings.TrimSpace(request.DeviceName)
	if errMsg, err := base.ValidateInputStruct(request); err != nil {
		apiReturn.ErrorParamFomat(c, errMsg)
		return
	}
	if request.ClientType != models.SessionClientWeb && request.ClientType != models.SessionClientChromeExtension {
		apiReturn.ErrorParamFomat(c, "clientType is not enabled for device sessions")
		return
	}
	info, ok := authenticateCredentials(c, request.LoginLoginVerify)
	if !ok {
		return
	}
	stored, pair, err := sessionlib.NewManager(global.Db).Create(c.Request.Context(), sessionlib.CreateRequest{
		UserID: info.ID, DeviceID: request.DeviceID, DeviceName: request.DeviceName, ClientType: request.ClientType,
	})
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	writeSessionResponse(c, info, stored, pair)
}

func (l LoginApi) SessionUpgrade(c *gin.Context) {
	if mode, _ := c.Get(sessionlib.GinAuthModeKey); mode != sessionlib.AuthModeLegacy {
		apiReturn.ErrorByCode(c, 1001)
		return
	}
	var request struct {
		DeviceID   string `json:"deviceId" validate:"required,max=128"`
		DeviceName string `json:"deviceName" validate:"required,max=100"`
		ClientType string `json:"clientType" validate:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	request.DeviceID = strings.TrimSpace(request.DeviceID)
	request.DeviceName = strings.TrimSpace(request.DeviceName)
	if errMsg, err := base.ValidateInputStruct(request); err != nil {
		apiReturn.ErrorParamFomat(c, errMsg)
		return
	}
	if request.ClientType != models.SessionClientChromeExtension {
		apiReturn.ErrorParamFomat(c, "legacy upgrade is only available to Chrome Extension")
		return
	}
	info, _ := base.GetCurrentUserInfo(c)
	stored, pair, err := sessionlib.NewManager(global.Db).Create(c.Request.Context(), sessionlib.CreateRequest{
		UserID: info.ID, DeviceID: request.DeviceID, DeviceName: request.DeviceName, ClientType: request.ClientType,
	})
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	if legacyClientToken := c.GetHeader("token"); legacyClientToken != "" && global.CUserToken != nil {
		global.CUserToken.Delete(legacyClientToken)
	}
	writeSessionResponse(c, info, stored, pair)
}

func writeSessionResponse(c *gin.Context, info models.User, stored models.UserSession, pair sessionlib.Pair) {
	apiReturn.SuccessData(c, gin.H{
		"user": sessionUser{
			ID: info.ID, UserID: info.ID, Username: info.Username, Name: info.Name,
			HeadImage: info.HeadImage, Role: info.Role, Mail: info.Mail, Status: info.Status,
		},
		"sessionId":   stored.ID,
		"accessToken": pair.AccessToken, "refreshToken": pair.RefreshToken,
		"accessExpiresAt": pair.AccessExpiresAt, "refreshExpiresAt": pair.RefreshExpiresAt,
	})
}

func (l LoginApi) SessionRefresh(c *gin.Context) {
	var request struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || strings.TrimSpace(request.RefreshToken) == "" {
		if err != nil {
			apiReturn.ErrorParamFomat(c, err.Error())
		} else {
			apiReturn.ErrorParamFomat(c, "refreshToken is required")
		}
		return
	}
	pair, err := sessionlib.NewManager(global.Db).RotateRefresh(c.Request.Context(), request.RefreshToken)
	if err != nil {
		if errors.Is(err, sessionlib.ErrInvalidRefreshToken) ||
			errors.Is(err, sessionlib.ErrRefreshTokenExpired) ||
			errors.Is(err, sessionlib.ErrRefreshTokenReuse) ||
			errors.Is(err, sessionlib.ErrSessionRevoked) {
			apiReturn.ErrorByCode(c, 1001)
			return
		}
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	apiReturn.SuccessData(c, pair)
}
