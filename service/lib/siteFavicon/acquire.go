package siteFavicon

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// Acquire fetches the page once and tries its icons under one total deadline.
// The caller supplies a context tied to the API request; no detached downloads.
func Acquire(ctx context.Context, rawURL, directory string) (*os.File, []string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	base, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") || base.User != nil {
		return nil, nil, fmt.Errorf("请输入完整的 http:// 或 https:// 网站地址")
	}
	client := &http.Client{Timeout: 6 * time.Second}
	candidates, pageErr := discover(ctx, client, base)
	var lastErr error
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			break
		}
		file, err := downloadCandidate(ctx, client, candidate, directory)
		if err == nil {
			return file, candidates, nil
		}
		lastErr = err
	}
	if ctx.Err() != nil {
		return nil, candidates, fmt.Errorf("获取图标超时，请重试或上传图片；内网地址需要服务器能够访问")
	}
	if pageErr != nil {
		return nil, candidates, fmt.Errorf("服务器无法读取网站（%v），默认图标也不可用；网站可能限制抓取，内网地址需要服务器能够访问", pageErr)
	}
	return nil, candidates, fmt.Errorf("网站图标均不可用（%v），请上传图片或填写有效图片地址", lastErr)
}

func iconRequest(ctx context.Context, client *http.Client, target string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 PanelNext/1.0")
	return client.Do(req)
}

func discover(ctx context.Context, client *http.Client, base *url.URL) ([]string, error) {
	var candidates []string
	seen := map[string]bool{}
	add := func(reference string, against *url.URL) {
		ref, err := url.Parse(strings.TrimSpace(reference))
		if err != nil || reference == "" {
			return
		}
		resolved := against.ResolveReference(ref)
		resolved.Fragment = ""
		if resolved.Host == "" || resolved.User != nil || (resolved.Scheme != "http" && resolved.Scheme != "https") {
			return
		}
		value := resolved.String()
		if !seen[value] && len(candidates) < 5 {
			seen[value] = true
			candidates = append(candidates, value)
		}
	}
	resp, pageErr := iconRequest(ctx, client, base.String())
	if pageErr == nil {
		defer resp.Body.Close()
		base = resp.Request.URL // Relative icons follow redirects, not the input URL.
		if resp.StatusCode == http.StatusOK {
			doc, err := goquery.NewDocumentFromReader(io.LimitReader(resp.Body, 2<<20))
			pageErr = err
			if err == nil {
				linkBase := base
				if href, exists := doc.Find("base[href]").First().Attr("href"); exists {
					if parsed, err := url.Parse(href); err == nil {
						linkBase = base.ResolveReference(parsed)
					}
				}
				doc.Find("link[href]").Each(func(_ int, s *goquery.Selection) {
					rel, _ := s.Attr("rel")
					for _, token := range strings.Fields(strings.ToLower(rel)) {
						if token == "icon" || token == "apple-touch-icon" || token == "apple-touch-icon-precomposed" {
							href, _ := s.Attr("href")
							add(href, linkBase)
							break
						}
					}
				})
			}
		} else {
			pageErr = fmt.Errorf("HTTP %d", resp.StatusCode)
		}
	}
	// Always reserve a fallback slot, even if page access was denied or timed out.
	fallback := *base
	fallback.Path, fallback.RawPath, fallback.RawQuery, fallback.Fragment = "/favicon.ico", "", "", ""
	if !seen[fallback.String()] {
		candidates = append(candidates, fallback.String())
	}
	return candidates, pageErr
}

func downloadCandidate(ctx context.Context, client *http.Client, target, directory string) (*os.File, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	resp, err := iconRequest(ctx, client, target)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > 1<<20 {
		return nil, fmt.Errorf("图标为空或超过 1 MB")
	}
	ext, err := ImageExtension(data)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(directory, "icon-*"+ext)
	if err != nil {
		return nil, err
	}
	if _, err = file.Write(data); err != nil {
		file.Close()
		os.Remove(file.Name())
		return nil, err
	}
	if err = file.Close(); err != nil {
		os.Remove(file.Name())
		return nil, err
	}
	return file, nil
}

// ImageExtension sniffs downloaded bytes and returns the extension to store
// them under, refusing anything that is not an image (login pages, HTML).
func ImageExtension(data []byte) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("图标为空")
	}
	contentType := http.DetectContentType(data)
	prefix := strings.ToLower(strings.TrimSpace(string(data[:minLength(len(data), 512)])))
	isSVG := (strings.HasPrefix(prefix, "<svg") || strings.HasPrefix(prefix, "<?xml")) && strings.Contains(prefix, "<svg")
	isICO := len(data) >= 4 && data[0] == 0 && data[1] == 0 && data[2] == 1 && data[3] == 0
	switch {
	case isSVG:
		return ".svg", nil
	case isICO:
		return ".ico", nil
	case contentType == "image/png":
		return ".png", nil
	case contentType == "image/jpeg":
		return ".jpg", nil
	case contentType == "image/gif":
		return ".gif", nil
	case contentType == "image/webp":
		return ".webp", nil
	case strings.HasPrefix(contentType, "image/"):
		return ".img", nil
	}
	return "", fmt.Errorf("返回的不是图片，可能是登录页或防爬验证页")
}

func minLength(a, b int) int {
	if a < b {
		return a
	}
	return b
}
