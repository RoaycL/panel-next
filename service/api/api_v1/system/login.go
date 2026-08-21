package system

import (
	"errors"
	"strconv"
	"strings"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	"panel-next/lib/cmn"
	sessionlib "panel-next/lib/session"
	"panel-next/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type LoginApi struct {
}

// 登录输入验证
type LoginLoginVerify struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required,max=50"`
	VCode    string `json:"vcode" validate:"max=6"`
	Email    string `json:"email"`
}

// @Summary 登录账号
// @Accept application/json
// @Produce application/json
// @Param LoginLoginVerify body LoginLoginVerify true "登陆验证信息"
// @Tags user
// @Router /login [post]
func (l LoginApi) Login(c *gin.Context) {
	legacyUntil := global.Config.GetValueStringOrDefault("session", "legacy_token_until")
	if !sessionlib.LegacyTokenCompatibilityActive(legacyUntil, time.Now()) {
		apiReturn.ErrorByCode(c, 1009)
		return
	}
	param := LoginLoginVerify{}
	if err := c.ShouldBindJSON(&param); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	if errMsg, err := base.ValidateInputStruct(param); err != nil {
		apiReturn.ErrorParamFomat(c, errMsg)
		return
	}

	info, ok := authenticateCredentials(c, param)
	if !ok {
		return
	}
	mUser := models.User{}
	bToken := ""

	bToken = info.Token
	if info.Token == "" {
		// 生成token
		buildTokenOver := false
		for !buildTokenOver {
			bToken = cmn.BuildRandCode(32, cmn.RAND_CODE_MODE2)
			if _, err := mUser.GetUserInfoByToken(bToken); err != nil {
				// 保存token
				mUser.UpdateUserInfoByUserId(info.ID, map[string]interface{}{
					"token": bToken,
				})
				buildTokenOver = true
			}
		}
		info.Token = bToken
	}
	info.Password = ""
	info.ReferralCode = ""

	// global.UserToken.SetDefault(bToken, info)
	cToken := uuid.NewString() + "-" + cmn.Md5(cmn.Md5("userId"+strconv.Itoa(int(info.ID))))
	global.CUserToken.SetDefault(cToken, bToken)
	// 设置当前用户信息
	c.Set("userInfo", info)
	info.Token = cToken // 重要 采用cToken,隐藏真实token
	apiReturn.SuccessData(c, info)
}

func authenticateCredentials(c *gin.Context, param LoginLoginVerify) (models.User, bool) {
	mUser := models.User{}
	info, err := mUser.GetUserInfoByUsernameAndPassword(strings.TrimSpace(param.Username), cmn.PasswordEncryption(param.Password))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiReturn.ErrorByCode(c, 1003)
		return models.User{}, false
	}
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return models.User{}, false
	}
	if info.Status != 1 {
		apiReturn.ErrorByCode(c, 1004)
		return models.User{}, false
	}
	return info, true
}

// 安全退出
func (l *LoginApi) Logout(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	if sessionID, exists := c.Get(sessionlib.GinSessionIDKey); exists {
		if id, ok := sessionID.(string); ok && id != "" {
			if err := sessionlib.NewManager(global.Db).RevokeDevice(c.Request.Context(), userInfo.ID, id); err != nil {
				apiReturn.ErrorDatabase(c, err.Error())
				return
			}
		}
	}
	cToken := c.GetHeader("token")
	global.CUserToken.Delete(cToken)
	apiReturn.Success(c)
}
