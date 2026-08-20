package trending

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const providerUserAgent = "Panel-Next trending widget"

// WeiboProvider 抓取微博热搜实时榜。
type WeiboProvider struct {
	endpoint string
}

func NewWeiboProvider(endpoint string) *WeiboProvider {
	return &WeiboProvider{endpoint: endpoint}
}

func (provider *WeiboProvider) Name() string { return "weibo" }

func (provider *WeiboProvider) Fetch(ctx context.Context, client *http.Client) ([]Item, error) {
	var response struct {
		Ok   int `json:"ok"`
		Data struct {
			Realtime []struct {
				Word string `json:"word"`
				Num  int64  `json:"num"`
			} `json:"realtime"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, client, provider.endpoint, providerUserAgent, &response); err != nil {
		return nil, fmt.Errorf("weibo request: %w", err)
	}
	if response.Ok != 1 {
		return nil, fmt.Errorf("weibo upstream rejected request with ok=%d", response.Ok)
	}
	items := make([]Item, 0, len(response.Data.Realtime))
	for _, entry := range response.Data.Realtime {
		title := sanitizeTitle(entry.Word)
		if title == "" {
			continue
		}
		link := "https://s.weibo.com/weibo?q=" + url.QueryEscape("#"+title+"#")
		items = append(items, Item{Title: title, URL: link, Score: entry.Num})
	}
	return items, nil
}

// BaiduProvider 抓取百度实时热搜榜。
type BaiduProvider struct {
	endpoint string
}

func NewBaiduProvider(endpoint string) *BaiduProvider {
	return &BaiduProvider{endpoint: endpoint}
}

func (provider *BaiduProvider) Name() string { return "baidu" }

func (provider *BaiduProvider) Fetch(ctx context.Context, client *http.Client) ([]Item, error) {
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Cards []struct {
				Content []struct {
					Word     string `json:"word"`
					Desc     string `json:"desc"`
					HotScore string `json:"hotScore"`
					URL      string `json:"url"`
					AppURL   string `json:"appUrl"`
				} `json:"content"`
			} `json:"cards"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, client, provider.endpoint, providerUserAgent, &response); err != nil {
		return nil, fmt.Errorf("baidu request: %w", err)
	}
	if !response.Success {
		return nil, fmt.Errorf("baidu upstream reported failure")
	}
	items := make([]Item, 0)
	for _, card := range response.Data.Cards {
		for _, entry := range card.Content {
			title := sanitizeTitle(entry.Word)
			if title == "" {
				continue
			}
			link := strings.TrimSpace(entry.URL)
			if link == "" {
				link = strings.TrimSpace(entry.AppURL)
			}
			if link == "" {
				link = "https://www.baidu.com/s?wd=" + url.QueryEscape(title)
			}
			var score int64
			if parsed, err := strconv.ParseInt(strings.TrimSpace(entry.HotScore), 10, 64); err == nil {
				score = parsed
			}
			items = append(items, Item{Title: title, URL: link, Score: score})
		}
	}
	return items, nil
}

var zhihuQuestionPattern = regexp.MustCompile(`/questions/(\d+)`)

// ZhihuProvider 抓取知乎热榜。
type ZhihuProvider struct {
	endpoint string
}

func NewZhihuProvider(endpoint string) *ZhihuProvider {
	return &ZhihuProvider{endpoint: endpoint}
}

func (provider *ZhihuProvider) Name() string { return "zhihu" }

func (provider *ZhihuProvider) Fetch(ctx context.Context, client *http.Client) ([]Item, error) {
	var response struct {
		Data []struct {
			Target struct {
				Title string `json:"title"`
				URL   string `json:"url"`
			} `json:"target"`
			DetailText string `json:"detail_text"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, client, provider.endpoint, providerUserAgent, &response); err != nil {
		return nil, fmt.Errorf("zhihu request: %w", err)
	}
	items := make([]Item, 0, len(response.Data))
	for _, entry := range response.Data {
		title := sanitizeTitle(entry.Target.Title)
		if title == "" {
			continue
		}
		link := normalizeZhihuLink(entry.Target.URL, title)
		items = append(items, Item{Title: title, URL: link, Score: parseZhihuHeat(entry.DetailText)})
	}
	return items, nil
}

func normalizeZhihuLink(rawURL, title string) string {
	rawURL = strings.TrimSpace(rawURL)
	if match := zhihuQuestionPattern.FindStringSubmatch(rawURL); match != nil {
		return "https://www.zhihu.com/question/" + match[1]
	}
	if rawURL == "" {
		return "https://www.zhihu.com/search?type=content&q=" + url.QueryEscape(title)
	}
	return rawURL
}

var zhihuHeatPattern = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*万`)

func parseZhihuHeat(detail string) int64 {
	if match := zhihuHeatPattern.FindStringSubmatch(detail); match != nil {
		if value, err := strconv.ParseFloat(match[1], 64); err == nil {
			return int64(value * 10000)
		}
	}
	return 0
}

// HackerNewsProvider 抓取 Hacker News 首页，服务无中文数据源偏好的用户。
type HackerNewsProvider struct {
	endpoint string
}

func NewHackerNewsProvider(endpoint string) *HackerNewsProvider {
	return &HackerNewsProvider{endpoint: endpoint}
}

func (provider *HackerNewsProvider) Name() string { return "hackernews" }

func (provider *HackerNewsProvider) Fetch(ctx context.Context, client *http.Client) ([]Item, error) {
	var response struct {
		Hits []struct {
			ObjectID string `json:"objectID"`
			Title    string `json:"title"`
			URL      string `json:"url"`
			Points   int64  `json:"points"`
		} `json:"hits"`
	}
	if err := fetchJSON(ctx, client, provider.endpoint, providerUserAgent, &response); err != nil {
		return nil, fmt.Errorf("hackernews request: %w", err)
	}
	items := make([]Item, 0, len(response.Hits))
	for _, hit := range response.Hits {
		title := sanitizeTitle(hit.Title)
		if title == "" {
			continue
		}
		link := strings.TrimSpace(hit.URL)
		if link == "" && hit.ObjectID != "" {
			link = "https://news.ycombinator.com/item?id=" + url.QueryEscape(hit.ObjectID)
		}
		if link == "" {
			continue
		}
		items = append(items, Item{Title: title, URL: link, Score: hit.Points})
	}
	return items, nil
}
