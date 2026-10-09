package imgbed

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

var ErrListForbidden = fmt.Errorf("imgbed list forbidden")

// ListItem 图床中的一张图片。
type ListItem struct {
	Name string `json:"name"` // 图床内的文件路径
	URL  string `json:"url"`  // 可公开访问的完整 URL
}

// ListResult 一页图片及图床报告的总数。
type ListResult struct {
	Items []ListItem `json:"items"`
	Total int        `json:"total"`
}

type listedFile struct {
	Name     string `json:"name"`
	Metadata struct {
		FileType string `json:"FileType"`
	} `json:"metadata"`
}

// List 按页列出图床中的图片（CloudFlare-ImgBed /api/manage/list，Token 需 list 权限）。
func (c *Client) List(ctx context.Context, config Config, start, count int) (ListResult, error) {
	if !config.IsValid() {
		return ListResult{}, ErrNotConfigured
	}
	base := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	query := url.Values{
		"start":     {strconv.Itoa(start)},
		"count":     {strconv.Itoa(count)},
		"recursive": {"true"},
		"fileType":  {"image"},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/manage/list?"+query.Encode(), nil)
	if err != nil {
		return ListResult{}, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(config.Token))

	response, err := c.httpClient.Do(request)
	if err != nil {
		return ListResult{}, fmt.Errorf("list request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return ListResult{}, ErrListForbidden
	}
	if response.StatusCode != http.StatusOK {
		return ListResult{}, fmt.Errorf("list failed: status %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, 8*maxResponseSize))
	if err != nil {
		return ListResult{}, fmt.Errorf("read list response: %w", err)
	}
	// 新版返回 {files, totalCount}；旧版直接返回文件数组。
	var files []listedFile
	total := -1
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal(body, &files); err != nil {
			return ListResult{}, fmt.Errorf("decode list response: %w", err)
		}
	} else {
		var page struct {
			Files      []listedFile `json:"files"`
			TotalCount *int         `json:"totalCount"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return ListResult{}, fmt.Errorf("decode list response: %w", err)
		}
		files = page.Files
		if page.TotalCount != nil {
			total = *page.TotalCount
		}
	}

	result := ListResult{Items: []ListItem{}}
	for _, file := range files {
		name := strings.TrimLeft(file.Name, "/")
		if name == "" || !isImageFile(name, file.Metadata.FileType) {
			continue
		}
		result.Items = append(result.Items, ListItem{Name: name, URL: base + "/file/" + escapePath(name)})
	}
	if total < 0 {
		// 旧版不报总数：本页满了就假定还有下一页。
		total = start + len(files)
		if len(files) >= count {
			total++
		}
	}
	result.Total = total
	return result, nil
}

func isImageFile(name, fileType string) bool {
	if fileType != "" {
		return strings.HasPrefix(strings.ToLower(fileType), "image/")
	}
	return IsAllowedExtension(name)
}

func escapePath(name string) string {
	parts := strings.Split(name, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
