package wallhaven

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultWallhavenEndpoint = "https://wallhaven.cc/api/v1/search"
	maxResponseBytes         = 2 << 20
	providerUserAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

var (
	ErrUpstreamUnavailable = errors.New("wallhaven service unavailable")
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

	cacheKey := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%d",
		params.Query, params.Categories, params.Purity, params.Sorting,
		params.Order, params.TopRange, params.AtLeast, params.Ratios, params.Page,
	)

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

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("wallhaven upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
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
			CurrentPage int `json:"current_page"`
			LastPage    int `json:"last_page"`
			PerPage     int `json:"per_page"`
			Total       int `json:"total"`
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
			CurrentPage: upstream.Meta.CurrentPage,
			LastPage:    upstream.Meta.LastPage,
			PerPage:     upstream.Meta.PerPage,
			Total:       upstream.Meta.Total,
		},
		FetchedAt: now.UTC(),
		Cached:    false,
	}

	client.mu.Lock()
	client.cache[cacheKey] = cacheEntry{
		result:    result,
		expiresAt: now.Add(client.ttl),
	}
	client.mu.Unlock()

	return result, nil
}
