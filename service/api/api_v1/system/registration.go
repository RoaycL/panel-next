package system

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/global"
	"panel-next/lib/cmn"
	"panel-next/lib/cmn/systemSetting"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

func (l LoginApi) Register(c *gin.Context) {
	settings := systemSetting.ApplicationSetting{}
	if err := global.SystemSetting.GetValueByInterface(systemSetting.SYSTEM_APPLICATION, &settings); err != nil {
		apiReturn.Error(c, "暂时无法读取注册配置，请稍后重试")
		return
	}
	if !settings.OpenRegister {
		apiReturn.ErrorCode(c, 1700, "管理员尚未开放注册", nil)
		return
	}
	if c.Request.ContentLength > 8<<10 {
		apiReturn.Error(c, "注册信息内容过大")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var request struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		apiReturn.Error(c, "注册信息格式错误或内容过大")
		return
	}
	request.Username = strings.TrimSpace(request.Username)
	request.Name = strings.TrimSpace(request.Name)
	if err := cmn.ValidateAccountUsername(request.Username); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	if utf8.RuneCountInString(request.Name) > 15 {
		apiReturn.Error(c, "昵称最多 15 个字符")
		return
	}
	if request.Name == "" {
		request.Name = string([]rune(request.Username)[:minAccountNameLength(request.Username)])
	}
	hash, err := cmn.HashPassword(request.Password)
	if err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	// Never bind user models here: role, status, mail, token and IDs cannot be supplied.
	user := models.User{Username: request.Username, Name: request.Name, Password: hash, Status: 1, Role: 2}
	created, err := user.CreateOne()
	if errors.Is(err, models.ErrUsernameExists) {
		apiReturn.ErrorCode(c, 1701, "该用户名已被使用", nil)
		return
	}
	if err != nil {
		apiReturn.Error(c, "注册失败，请稍后重试")
		return
	}
	apiReturn.SuccessData(c, gin.H{"id": created.ID, "username": created.Username})
}

func minAccountNameLength(username string) int {
	if len(username) > 15 {
		return 15
	}
	return len(username)
}

func (l LoginApi) AccountSettingsGet(c *gin.Context) {
	settings := systemSetting.ApplicationSetting{}
	if err := global.SystemSetting.GetValueByInterface(systemSetting.SYSTEM_APPLICATION, &settings); err != nil {
		apiReturn.Error(c, "账号配置读取失败")
		return
	}
	apiReturn.SuccessData(c, gin.H{"openRegister": settings.OpenRegister})
}

func (l LoginApi) AccountSettingsSet(c *gin.Context) {
	var request struct {
		OpenRegister *bool `json:"openRegister"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.OpenRegister == nil {
		apiReturn.Error(c, "openRegister 必须为布尔值")
		return
	}
	// Preserve unrelated application settings, including settings from older installations.
	settings := map[string]interface{}{}
	if err := global.SystemSetting.GetValueByInterface(systemSetting.SYSTEM_APPLICATION, &settings); err != nil {
		apiReturn.Error(c, "账号配置读取失败")
		return
	}
	if settings == nil {
		apiReturn.Error(c, "账号配置无效，未修改注册开关")
		return
	}
	settings["openRegister"] = *request.OpenRegister
	delete(settings, "emailSuffix")
	if err := global.SystemSetting.Set(systemSetting.SYSTEM_APPLICATION, settings); err != nil {
		apiReturn.Error(c, "账号配置保存失败")
		return
	}
	apiReturn.SuccessData(c, gin.H{"openRegister": *request.OpenRegister})
}
