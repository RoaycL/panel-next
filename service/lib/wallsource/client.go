// Package wallsource proxies the wallpaper sources shown next to Wallhaven in
// the wallpaper library (Bing daily, Konachan, yande.re) and
// normalizes their results into one item shape.
package wallsource

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	perPage           = 24
	maxResponseBytes  = 4 << 20
	maxCacheEntries   = 256
	providerUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

var (
	ErrInvalidParams      = errors.New("invalid wallpaper search parameters")
	ErrUpstreamRateLimit  = errors.New("壁纸源请求次数已达上限，请稍后再试")
	bitsetPattern         = regexp.MustCompile(`^[01]{3}$`)
	reservedBooruMetatags = regexp.MustCompile(`^-?(rating|order|limit|width|height):`)
)

var sourceLabels = map[string]string{
	"bing":     "Bing",
	"konachan": "Konachan",
	"yandere":  "yande.re",
}

// Item matches the Wallhaven item shape so the gallery can render every source alike.
type Item struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	RawURL     string `json:"rawUrl"`
	ThumbURL   string `json:"thumbUrl"`
	Resolution string `json:"resolution"`
	Category   string `json:"category"`
	FileSize   int64  `json:"fileSize"`
	Favorites  int64  `json:"favorites"`
	Title      string `json:"title,omitempty"`
	Author     string `json:"author,omitempty"`
	AuthorURL  string `json:"authorUrl,omitempty"`
}

type MetaInfo struct {
	CurrentPage int `json:"currentPage"`
	LastPage    int `json:"lastPage"`
	PerPage     int `json:"perPage"`
	Total       int `json:"total"`
}

type Result struct {
	Items     []Item    `json:"items"`
	Meta      MetaInfo  `json:"meta"`
	FetchedAt time.Time `json:"fetchedAt"`
	Cached    bool      `json:"cached"`
}

type SearchParams struct {
	Source  string
	Query   string
	Purity  string // booru ratings: safe / questionable / explicit
	Sorting string
	Page    int
}

// Endpoints are the upstream base URLs; tests point them at httptest servers.
type Endpoints struct {
	Bing     string
	Konachan string
	Yandere  string
}

var DefaultEndpoints = Endpoints{
	Bing:     "https://cn.bing.com",
	Konachan: "https://konachan.com",
	Yandere:  "https://yande.re",
}

type cacheEntry struct {
	result    Result
	expiresAt time.Time
}

type Client struct {
	httpClient *http.Client
	endpoints  Endpoints
	ttl        time.Duration
	mu         sync.Mutex
	cache      map[string]cacheEntry
}

func NewClient(httpClient *http.Client, endpoints Endpoints, ttl time.Duration) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 12 * time.Second}
	}
	isolated := *httpClient
	// Provider redirects must never forward a user's credential to another host.
	isolated.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{httpClient: &isolated, endpoints: endpoints, ttl: ttl, cache: make(map[string]cacheEntry)}
}

var DefaultClient = NewClient(&http.Client{Timeout: 12 * time.Second}, DefaultEndpoints, 15*time.Minute)

var validSorting = map[string]map[string]bool{
	"bing":     {"": true},
	"konachan": {"": true, "date": true, "score": true, "random": true},
	"yandere":  {"": true, "date": true, "score": true, "random": true},
}

func validate(params *SearchParams) error {
	sortings, known := validSorting[params.Source]
	if !known || !sortings[params.Sorting] || params.Page < 1 || params.Page > 100 ||
		utf8.RuneCountInString(params.Query) > 100 {
		return ErrInvalidParams
	}
	if params.Source == "konachan" || params.Source == "yandere" {
		if params.Purity == "" {
			params.Purity = "100"
		}
		if !bitsetPattern.MatchString(params.Purity) || params.Purity == "000" {
			return ErrInvalidParams
		}
		tags := strings.Fields(params.Query)
		if len(tags) > 4 {
			return ErrInvalidParams
		}
		for _, tag := range tags {
			if reservedBooruMetatags.MatchString(strings.ToLower(tag)) {
				return ErrInvalidParams
			}
		}
	} else {
		params.Purity = ""
	}
	return nil
}

func (client *Client) Search(ctx context.Context, params SearchParams) (Result, error) {
	if params.Page <= 0 {
		params.Page = 1
	}
	params.Query = strings.TrimSpace(params.Query)
	if err := validate(&params); err != nil {
		return Result{}, err
	}

	encodedParams, _ := json.Marshal(params)
	cacheKey := fmt.Sprintf("%x", sha256.Sum256(encodedParams))
	now := time.Now()
	client.mu.Lock()
	entry, found := client.cache[cacheKey]
	client.mu.Unlock()
	if found && now.Before(entry.expiresAt) {
		entry.result.Cached = true
		return entry.result, nil
	}

	var (
		result Result
		err    error
	)
	switch params.Source {
	case "bing":
		result, err = client.searchBing(ctx)
	case "konachan":
		result, err = client.searchBooru(ctx, client.endpoints.Konachan, "Konachan", params)
	case "yandere":
		result, err = client.searchBooru(ctx, client.endpoints.Yandere, "yande.re", params)
	}
	if err != nil {
		return Result{}, err
	}
	if result.Items == nil {
		result.Items = []Item{}
	}
	result.FetchedAt = now.UTC()

	client.mu.Lock()
	client.pruneCacheLocked(now)
	client.cache[cacheKey] = cacheEntry{result: result, expiresAt: now.Add(client.ttl)}
	client.mu.Unlock()
	return result, nil
}

// get fetches an upstream URL; the caller closes the body of a 200 response.
func (client *Client) get(ctx context.Context, source, fullURL string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", providerUserAgent)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s 服务暂时无法访问，请稍后重试", sourceLabels[source])
	}
	if resp.StatusCode == http.StatusOK {
		return resp, nil
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrUpstreamRateLimit
	}
	return nil, fmt.Errorf("%s 返回异常状态 %d，请稍后重试", sourceLabels[source], resp.StatusCode)
}

func decodeJSON(resp *http.Response, target any) error {
	defer resp.Body.Close()
	return json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(target)
}

func resolution(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	return fmt.Sprintf("%dx%d", width, height)
}

func (client *Client) pruneCacheLocked(now time.Time) {
	for key, candidate := range client.cache {
		if !now.Before(candidate.expiresAt) {
			delete(client.cache, key)
		}
	}
	for len(client.cache) >= maxCacheEntries {
		for key := range client.cache {
			delete(client.cache, key)
			break
		}
	}
}
