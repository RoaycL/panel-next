package imgbed

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	"panel-next/lib/imgbed"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const IMGBED_CONFIG = "imgbed_config"

type ImgbedApi struct{}

type imgbedConfigResponse struct {
	Configured bool   `json:"configured"`
	BaseURL    string `json:"baseUrl"`
	Token      string `json:"token"` // 脱敏返回
}

type imgbedConfigRequest struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

var defaultClient = imgbed.NewClient()

func readImgbedConfig() imgbed.Config {
	cfg := imgbed.Config{}
	if err := global.SystemSetting.GetValueByInterface(IMGBED_CONFIG, &cfg); err != nil {
		return imgbed.Config{}
	}
	return cfg
}

func saveImgbedConfig(cfg imgbed.Config) error {
	return global.SystemSetting.Set(IMGBED_CONFIG, cfg)
}

// GetConfig 管理员获取图床配置
func (a *ImgbedApi) GetConfig(c *gin.Context) {
	cfg := readImgbedConfig()
	resp := imgbedConfigResponse{
		Configured: cfg.IsValid(),
		BaseURL:    cfg.BaseURL,
		Token:      maskToken(cfg.Token),
	}
	apiReturn.SuccessData(c, resp)
}

// SetConfig 管理员设置图床配置
func (a *ImgbedApi) SetConfig(c *gin.Context) {
	req := imgbedConfigRequest{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	cfg := imgbed.Config{
		BaseURL: strings.TrimSpace(req.BaseURL),
		Token:   strings.TrimSpace(req.Token),
	}

	// 如果 Token 是脱敏值（包含 *），保留原 Token
	if strings.Contains(req.Token, "***") {
		existing := readImgbedConfig()
		cfg.Token = existing.Token
	}

	if cfg.BaseURL != "" || cfg.Token != "" {
		if !cfg.IsValid() {
			apiReturn.ErrorParamFomat(c, "baseUrl or token")
			return
		}
	}

	if err := saveImgbedConfig(cfg); err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}

	resp := imgbedConfigResponse{
		Configured: cfg.IsValid(),
		BaseURL:    cfg.BaseURL,
		Token:      maskToken(cfg.Token),
	}
	apiReturn.SuccessData(c, resp)
}

// TestConfig 管理员测试图床连接
func (a *ImgbedApi) TestConfig(c *gin.Context) {
	cfg := readImgbedConfig()
	if !cfg.IsValid() {
		apiReturn.Error(c, "imgbed not configured")
		return
	}

	if err := defaultClient.TestConnection(cfg); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	apiReturn.Success(c)
}

// Upload 代理上传文件到图床（需登录）
func (a *ImgbedApi) Upload(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)

	cfg := readImgbedConfig()
	if !cfg.IsValid() {
		apiReturn.Error(c, "imgbed not configured")
		return
	}

	file, err := c.FormFile("imgfile")
	if err != nil {
		apiReturn.ErrorByCode(c, 1300)
		return
	}

	fileName := file.Filename
	if !imgbed.IsAllowedExtension(fileName) {
		apiReturn.ErrorByCode(c, 1301)
		return
	}

	// 限制文件大小 20MB
	if file.Size > 20<<20 {
		apiReturn.Error(c, "file too large (max 20MB)")
		return
	}

	opened, err := file.Open()
	if err != nil {
		apiReturn.Error(c, "failed to open uploaded file")
		return
	}
	defer opened.Close()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	results, err := defaultClient.Upload(ctx, cfg, opened, fileName, file.Header.Get("Content-Type"))
	if err != nil {
		// The upstream error can echo the image host's response body; keep it in
		// the log and give the user a stable message.
		global.Logger.Errorln("imgbed upload failed:", err)
		apiReturn.Error(c, "图床上传失败，请稍后重试或联系管理员")
		return
	}

	if len(results) == 0 {
		apiReturn.Error(c, "imgbed returned no results")
		return
	}

	// 记录到本地文件表
	apiReturn.SuccessData(c, gin.H{
		"imageUrl": results[0].PublicURL,
		"userId":   userInfo.ID,
	})
}

// Status 当前用户能否在图库中浏览外部图床（已配置且为管理员）
func (a *ImgbedApi) Status(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	apiReturn.SuccessData(c, gin.H{"available": userInfo.Role == 1 && readImgbedConfig().IsValid()})
}

type imgbedListRequest struct {
	Page  int `form:"page"`
	Limit int `form:"limit"`
}

// List 管理员分页浏览图床中的图片
func (a *ImgbedApi) List(c *gin.Context) {
	req := imgbedListRequest{}
	if err := c.ShouldBindQuery(&req); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.Limit < 1 || req.Limit > 100 {
		req.Limit = 40
	}
	cfg := readImgbedConfig()
	if !cfg.IsValid() {
		apiReturn.Error(c, "imgbed not configured")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	result, err := defaultClient.List(ctx, cfg, (req.Page-1)*req.Limit, req.Limit)
	if errors.Is(err, imgbed.ErrListForbidden) {
		apiReturn.Error(c, "图床 Token 没有读取列表的权限，请在图床管理面板给 Token 勾选 list 权限")
		return
	}
	if err != nil {
		global.Logger.Errorln("imgbed list failed:", err)
		apiReturn.Error(c, "读取图床图片失败，请稍后重试")
		return
	}
	apiReturn.SuccessData(c, result)
}

func maskToken(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return strings.Repeat("*", len(token))
	}
	return token[:4] + strings.Repeat("*", len(token)-8) + token[len(token)-4:]
}

var _ = io.EOF
var _ = http.StatusOK
