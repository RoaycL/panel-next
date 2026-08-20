package trending

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// DefaultWeiboEndpoint 微博热搜实时榜公共接口。
	DefaultWeiboEndpoint = "https://weibo.com/ajax/side/hotSearch"
	// DefaultBaiduEndpoint 百度实时热搜榜公共接口。
	DefaultBaiduEndpoint = "https://top.baidu.com/api/board?platform=wise&tab=realtime"
	// DefaultZhihuEndpoint 知乎热榜公共接口。
	DefaultZhihuEndpoint = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50"
	// DefaultHackerNewsEndpoint Hacker News 前页公共搜索接口。
	DefaultHackerNewsEndpoint = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50"

	maxResponseBytes = 1 << 20
	maxTitleRunes    = 120
	maxItems         = 50
)

var (
	ErrUnknownSource = errors.New("unknown trending source")
	ErrInvalidLimit  = errors.New("invalid trending limit")
	ErrSourceEmptied = errors.New("trending source returned no usable items")
)

// Item 是各数据源归一化后的单条热搜/资讯条目。
type Item struct {
	Rank  int    `json:"rank"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Score int64  `json:"score,omitempty"`
}

// Result 是一次热搜读取的完整响应。
type Result struct {
	Source    string    `json:"source"`
	Items     []Item    `json:"items"`
	FetchedAt time.Time `json:"fetchedAt"`
	Cached    bool      `json:"cached"`
	Stale     bool      `json:"stale"`
}

// Provider 抽象一个可替换的热搜数据源。
type Provider interface {
	Name() string
	Fetch(ctx context.Context, client *http.Client) ([]Item, error)
}

type cacheEntry struct {
	result     Result
	expiresAt  time.Time
	staleUntil time.Time
}

// Client 聚合多个 Provider 并提供内存缓存与陈旧降级。
type Client struct {
	httpClient *http.Client
	ttl        time.Duration
	staleTTL   time.Duration
	now        func() time.Time

	mu        sync.Mutex
	providers map[string]Provider
	cache     map[string]cacheEntry
}

func NewClient(httpClient *http.Client, ttl, staleTTL time.Duration, providers ...Provider) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	client := &Client{
		httpClient: httpClient,
		ttl:        ttl,
		staleTTL:   staleTTL,
		now:        time.Now,
		providers:  make(map[string]Provider),
		cache:      make(map[string]cacheEntry),
	}
	for _, provider := range providers {
		client.Register(provider)
	}
	return client
}

// Register 注册或替换一个数据源，是热替换数据源的唯一入口。
func (client *Client) Register(provider Provider) {
	if provider == nil || provider.Name() == "" {
		return
	}
	client.mu.Lock()
	client.providers[provider.Name()] = provider
	client.mu.Unlock()
}

func (client *Client) Sources() []string {
	client.mu.Lock()
	defer client.mu.Unlock()
	sources := make([]string, 0, len(client.providers))
	for name := range client.providers {
		sources = append(sources, name)
	}
	sortStrings(sources)
	return sources
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

var DefaultClient = NewClient(
	&http.Client{Timeout: 5 * time.Second},
	5*time.Minute,
	6*time.Hour,
	NewWeiboProvider(DefaultWeiboEndpoint),
	NewBaiduProvider(DefaultBaiduEndpoint),
	NewZhihuProvider(DefaultZhihuEndpoint),
	NewHackerNewsProvider(DefaultHackerNewsEndpoint),
)

// Get 读取指定数据源并按 limit 截取，失败时回退陈旧缓存。
func (client *Client) Get(ctx context.Context, source string, limit int) (Result, error) {
	source = strings.TrimSpace(strings.ToLower(source))
	if limit < 1 || limit > maxItems {
		return Result{}, ErrInvalidLimit
	}

	client.mu.Lock()
	provider, found := client.providers[source]
	entry, cached := client.cache[source]
	client.mu.Unlock()
	if !found {
		return Result{}, ErrUnknownSource
	}
	now := client.now()
	if cached && now.Before(entry.expiresAt) {
		result := entry.result
		result.Cached = true
		result.Items = truncateItems(result.Items, limit)
		return result, nil
	}

	items, err := provider.Fetch(ctx, client.httpClient)
	if err != nil {
		if cached && now.Before(entry.staleUntil) {
			result := entry.result
			result.Cached = true
			result.Stale = true
			result.Items = truncateItems(result.Items, limit)
			return result, nil
		}
		return Result{}, err
	}
	if len(items) == 0 {
		if cached && now.Before(entry.staleUntil) {
			result := entry.result
			result.Cached = true
			result.Stale = true
			result.Items = truncateItems(result.Items, limit)
			return result, nil
		}
		return Result{}, ErrSourceEmptied
	}

	result := Result{Source: source, Items: truncateItems(items, maxItems), FetchedAt: now.UTC()}
	for index := range result.Items {
		result.Items[index].Rank = index + 1
	}
	client.mu.Lock()
	client.cache[source] = cacheEntry{
		result: result, expiresAt: now.Add(client.ttl), staleUntil: now.Add(client.staleTTL),
	}
	client.mu.Unlock()
	result.Items = truncateItems(result.Items, limit)
	return result, nil
}

func truncateItems(items []Item, limit int) []Item {
	if len(items) <= limit {
		return items
	}
	return items[:limit]
}

func sanitizeTitle(title string) string {
	title = strings.TrimSpace(title)
	if utf8.RuneCountInString(title) > maxTitleRunes {
		title = string([]rune(title)[:maxTitleRunes])
	}
	return title
}

func fetchJSON(ctx context.Context, client *http.Client, endpoint, userAgent string, target interface{}) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", userAgent)
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream returned status %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode upstream response: %w", err)
	}
	return nil
}
