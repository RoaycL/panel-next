package imgbed

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultTimeout  = 30 * time.Second
	maxResponseSize = 1 << 20 // 1 MiB
)

var (
	ErrNotConfigured = errors.New("imgbed not configured")
	ErrInvalidConfig = errors.New("invalid imgbed config")
	ErrUploadFailed  = errors.New("imgbed upload failed")
)

// Config 图床配置。
type Config struct {
	BaseURL string `json:"baseUrl"` // 图床服务地址，如 https://img.roayc.com
	Token   string `json:"token"`   // API Token（需 upload 权限）
}

// IsValid 校验配置是否完整可用。
func (c Config) IsValid() bool {
	c.BaseURL = strings.TrimSpace(c.BaseURL)
	c.Token = strings.TrimSpace(c.Token)
	if c.BaseURL == "" || c.Token == "" {
		return false
	}
	parsed, err := url.Parse(c.BaseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	return true
}

// UploadResult 上传响应。
type UploadResult struct {
	Src       string `json:"src"`       // 图床返回的相对路径或完整 URL
	PublicURL string `json:"publicUrl"` // 可公开访问的完整 URL
}

// Client 图床客户端。
type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: defaultTimeout},
	}
}

// Upload 上传文件到图床。
// fileContent 是文件内容，fileName 是原始文件名，contentType 是 MIME 类型。
func (c *Client) Upload(ctx interface{ Done() <-chan struct{} }, config Config, fileContent io.Reader, fileName, contentType string) ([]UploadResult, error) {
	if !config.IsValid() {
		return nil, ErrNotConfigured
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, fileContent); err != nil {
		return nil, fmt.Errorf("copy file content: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close multipart writer: %w", err)
	}

	uploadURL := strings.TrimRight(config.BaseURL, "/") + "/upload?returnFormat=full"
	request, err := http.NewRequest(http.MethodPost, uploadURL, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+config.Token)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("upload request: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("%w: status %d, body %s", ErrUploadFailed, response.StatusCode, string(respBody))
	}

	var results []UploadResult
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxResponseSize))
	if err := decoder.Decode(&results); err != nil {
		return nil, fmt.Errorf("decode upload response: %w", err)
	}

	for i, r := range results {
		if r.PublicURL == "" && r.Src != "" {
			if strings.HasPrefix(r.Src, "http://") || strings.HasPrefix(r.Src, "https://") {
				results[i].PublicURL = r.Src
			} else {
				results[i].PublicURL = strings.TrimRight(config.BaseURL, "/") + r.Src
			}
		}
	}

	return results, nil
}

// TestConnection 测试图床连接是否可用。
func (c *Client) TestConnection(config Config) error {
	if !config.IsValid() {
		return ErrInvalidConfig
	}

	testURL := strings.TrimRight(config.BaseURL, "/") + "/"
	request, err := http.NewRequest(http.MethodGet, testURL, nil)
	if err != nil {
		return fmt.Errorf("create test request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+config.Token)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("test connection: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("test connection failed: status %d", response.StatusCode)
	}
	return nil
}

// AllowedExtensions 返回图床支持的文件扩展名白名单。
func AllowedExtensions() []string {
	return []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif", ".bmp"}
}

// IsAllowedExtension 检查文件扩展名是否被图床支持。
func IsAllowedExtension(fileName string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	for _, allowed := range AllowedExtensions() {
		if ext == allowed {
			return true
		}
	}
	return false
}
