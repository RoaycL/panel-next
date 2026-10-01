package wallhaven

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultWallhavenEndpoint = "https://wallhaven.cc/api/v1/search"
	maxResponseBytes         = 2 << 20
	maxCacheEntries          = 256
	providerUserAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

var (
	ErrUpstreamUnavailable = errors.New("wallhaven service unavailable")
	ErrInvalidParams       = errors.New("invalid wallhaven search parameters")
	ErrUnauthorized        = errors.New("Wallhaven API Key 无效或无权访问此内容")
	apiKeyPattern          = regexp.MustCompile(`^[a-zA-Z0-9]{16,128}$`)
	bitsetPattern          = regexp.MustCompile(`^[01]{3}$`)
	resolutionPattern      = regexp.MustCompile(`^[0-9]{2,5}x[0-9]{2,5}$`)
	ratioPattern           = regexp.MustCompile(`^[0-9]{1,3}x[0-9]{1,3}(,[0-9]{1,3}x[0-9]{1,3}){0,7}$`)
)

type WallpaperItem struct {
	ID         string   `json:"id"`
	URL        string   `json:"url"`
	RawURL     string   `json:"rawUrl"`
	ThumbURL   string   `json:"thumbUrl"`
	Resolution string   `json:"resolution"`
	Category   string   `json:"category"`
	FileSize   int64    `json:"fileSize"`
	Colors     []string `json:"colors"`
	Views      int64    `json:"views"`
	Favorites  int64    `json:"favorites"`
}

type MetaInfo struct {
	CurrentPage int `json:"currentPage"`
	LastPage    int `json:"lastPage"`
	PerPage     int `json:"perPage"`
	Total       int `json:"total"`
}

// Wallhaven may encode pagination counts as JSON integers or decimal strings.
// Keep the public result numeric while rejecting malformed or overflowing values.
type upstreamCount int

func (count *upstreamCount) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))
	if strings.HasPrefix(raw, "\"") {
		if err := json.Unmarshal(data, &raw); err != nil {
			return fmt.Errorf("invalid wallhaven pagination count")
		}
	}
	if raw == "" || strings.IndexFunc(raw, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return fmt.Errorf("invalid wallhaven pagination count")
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fmt.Errorf("invalid wallhaven pagination count")
	}
	*count = upstreamCount(value)
	return nil
}

type Result struct {
	Items     []WallpaperItem `json:"items"`
	Meta      MetaInfo        `json:"meta"`
	FetchedAt time.Time       `json:"fetchedAt"`
	Cached    bool            `json:"cached"`
}

type cacheEntry struct {
	result    Result
	expiresAt time.Time
}

type Client struct {
	httpClient *http.Client
	endpoint   string
	ttl        time.Duration
	mu         sync.Mutex
	cache      map[string]cacheEntry
}

func NewClient(httpClient *http.Client, endpoint string, ttl time.Duration) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		httpClient: httpClient,
		endpoint:   strings.TrimRight(endpoint, "/"),
		ttl:        ttl,
		cache:      make(map[string]cacheEntry),
	}
}

var DefaultClient = NewClient(
	&http.Client{Timeout: 10 * time.Second},
	defaultWallhavenEndpoint,
	15*time.Minute,
)

type SearchParams struct {
	APIKey     string
	Query      string
	Categories string
	Purity     string
	Sorting    string
	Order      string
	TopRange   string
	AtLeast    string
	Ratios     string
	Page       int
}

func (client *Client) Search(ctx context.Context, params SearchParams) (Result, error) {
	if params.Categories == "" {
		params.Categories = "110" // General + Anime
	}
	if params.Purity == "" {
		params.Purity = "100" // SFW only
	}
	if params.Sorting == "" {
		params.Sorting = "toplist"
	}
	if params.Order == "" {
		params.Order = "desc"
	}
	if params.TopRange == "" {
		params.TopRange = "1M"
	}
	if params.AtLeast == "" {
		params.AtLeast = "1920x1080"
	}
	if params.Page <= 0 {
		params.Page = 1
	}
	if err := validateSearchParams(params); err != nil {
		return Result{}, err
	}

	encodedParams, _ := json.Marshal(params)
	cacheKey := fmt.Sprintf("%x", sha256.Sum256(encodedParams))

	now := time.Now()
	client.mu.Lock()
	entry, found := client.cache[cacheKey]
	if found && now.Before(entry.expiresAt) {
		client.mu.Unlock()
		entry.result.Cached = true
		return entry.result, nil
	}
	client.mu.Unlock()

	query := url.Values{
		"categories": {params.Categories},
		"purity":     {params.Purity},
		"sorting":    {params.Sorting},
		"order":      {params.Order},
		"topRange":   {params.TopRange},
		"atleast":    {params.AtLeast},
		"page":       {strconv.Itoa(params.Page)},
	}
	if params.Query != "" {
		query.Set("q", params.Query)
	}
	if params.Ratios != "" {
		query.Set("ratios", params.Ratios)
	}

	fullURL := client.endpoint + "?" + query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("User-Agent", providerUserAgent)
	req.Header.Set("Accept", "application/json")
	if params.APIKey != "" {
		req.Header.Set("X-API-Key", params.APIKey)
	}

	httpClient := client.httpClient
	if params.APIKey != "" {
		isolated := *httpClient
		// A provider redirect must never forward a user's credential to another host.
		isolated.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		httpClient = &isolated
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("wallhaven upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return Result{}, ErrUnauthorized
		}
		return Result{}, fmt.Errorf("wallhaven upstream status %d", resp.StatusCode)
	}

	var upstream struct {
		Data []struct {
			ID         string   `json:"id"`
			URL        string   `json:"url"`
			Resolution string   `json:"resolution"`
			Category   string   `json:"category"`
			FileSize   int64    `json:"file_size"`
			Colors     []string `json:"colors"`
			Views      int64    `json:"views"`
			Favorites  int64    `json:"favorites"`
			Path       string   `json:"path"`
			Thumbs     struct {
				Large    string `json:"large"`
				Original string `json:"original"`
				Small    string `json:"small"`
			} `json:"thumbs"`
		} `json:"data"`
		Meta struct {
			CurrentPage upstreamCount `json:"current_page"`
			LastPage    upstreamCount `json:"last_page"`
			PerPage     upstreamCount `json:"per_page"`
			Total       upstreamCount `json:"total"`
		} `json:"meta"`
	}

	decoder := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes))
	if err := decoder.Decode(&upstream); err != nil {
		return Result{}, fmt.Errorf("decode wallhaven response: %w", err)
	}

	items := make([]WallpaperItem, 0, len(upstream.Data))
	for _, item := range upstream.Data {
		thumb := item.Thumbs.Large
		if thumb == "" {
			thumb = item.Thumbs.Small
		}
		items = append(items, WallpaperItem{
			ID:         item.ID,
			URL:        item.URL,
			RawURL:     item.Path,
			ThumbURL:   thumb,
			Resolution: item.Resolution,
			Category:   item.Category,
			FileSize:   item.FileSize,
			Colors:     item.Colors,
			Views:      item.Views,
			Favorites:  item.Favorites,
		})
	}

	result := Result{
		Items: items,
		Meta: MetaInfo{
			CurrentPage: int(upstream.Meta.CurrentPage),
			LastPage:    int(upstream.Meta.LastPage),
			PerPage:     int(upstream.Meta.PerPage),
			Total:       int(upstream.Meta.Total),
		},
		FetchedAt: now.UTC(),
		Cached:    false,
	}

	client.mu.Lock()
	client.pruneCacheLocked(now)
	client.cache[cacheKey] = cacheEntry{
		result:    result,
		expiresAt: now.Add(client.ttl),
	}
	client.mu.Unlock()

	return result, nil
}

func validateSearchParams(params SearchParams) error {
	if (params.APIKey != "" && !apiKeyPattern.MatchString(params.APIKey)) || (len(params.Purity) == 3 && params.Purity[2] == '1' && params.APIKey == "") {
		return ErrUnauthorized
	}
	validSorting := map[string]bool{"date_added": true, "relevance": true, "random": true, "views": true, "favorites": true, "toplist": true, "hot": true}
	validTopRange := map[string]bool{"1d": true, "3d": true, "1w": true, "1M": true, "3M": true, "6M": true, "1y": true}
	if utf8.RuneCountInString(params.Query) > 100 || !bitsetPattern.MatchString(params.Categories) ||
		!bitsetPattern.MatchString(params.Purity) || !validSorting[params.Sorting] ||
		(params.Order != "asc" && params.Order != "desc") || !validTopRange[params.TopRange] ||
		!resolutionPattern.MatchString(params.AtLeast) || (params.Ratios != "" && !ratioPattern.MatchString(params.Ratios)) ||
		params.Page < 1 || params.Page > 100 {
		return ErrInvalidParams
	}
	return nil
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
