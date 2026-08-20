package trending

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientFetchesAndCachesWeibo(t *testing.T) {
	var upstreamCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		if request.URL.Path != "/weibo" {
			http.NotFound(response, request)
			return
		}
		_, _ = response.Write([]byte(`{"ok":1,"data":{"realtime":[{"word":"热搜第一条","num":123456},{"word":"  热搜第二条  ","num":654321},{"word":"","num":1}]}}`))
	}))
	defer server.Close()

	client := NewClient(server.Client(), time.Minute, time.Hour, NewWeiboProvider(server.URL+"/weibo"))
	first, err := client.Get(context.Background(), "weibo", 2)
	if err != nil {
		t.Fatal(err)
	}
	if first.Cached || first.Stale || len(first.Items) != 2 {
		t.Fatalf("unexpected first result: %#v", first)
	}
	if first.Items[0].Rank != 1 || first.Items[0].Title != "热搜第一条" || first.Items[0].URL == "" {
		t.Fatalf("unexpected first item: %#v", first.Items[0])
	}
	if first.Items[1].Title != "热搜第二条" || first.Items[1].Rank != 2 {
		t.Fatalf("expected trimmed title with rank, got %#v", first.Items[1])
	}

	second, err := client.Get(context.Background(), "weibo", 2)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Cached || second.Stale || len(second.Items) != 2 {
		t.Fatalf("unexpected cached result: %#v", second)
	}
	if upstreamCalls.Load() != 1 {
		t.Fatalf("expected one upstream call, got %d", upstreamCalls.Load())
	}

	full, err := client.Get(context.Background(), "weibo", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Items) != 2 {
		t.Fatalf("expected full cached list, got %d items", len(full.Items))
	}
}

func TestClientFallsBackToStaleCache(t *testing.T) {
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if fail.Load() {
			http.Error(response, "unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = response.Write([]byte(`{"success":true,"data":{"cards":[{"content":[{"word":"百度热榜","hotScore":"98765","url":"https://www.baidu.com/example"}]}]}}`))
	}))
	defer server.Close()

	now := time.Now()
	client := NewClient(server.Client(), time.Minute, time.Hour, NewBaiduProvider(server.URL))
	client.now = func() time.Time { return now }
	first, err := client.Get(context.Background(), "baidu", 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Items[0].Score != 98765 || first.Items[0].URL != "https://www.baidu.com/example" {
		t.Fatalf("unexpected baidu item: %#v", first.Items[0])
	}

	now = now.Add(2 * time.Minute)
	fail.Store(true)
	second, err := client.Get(context.Background(), "baidu", 10)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Cached || !second.Stale || len(second.Items) != 1 {
		t.Fatalf("expected stale cached result, got %#v", second)
	}
}

func TestProvidersNormalizeUpstreams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/zhihu":
			_, _ = response.Write([]byte(`{"data":[{"target":{"title":"知乎问题","url":"https://api.zhihu.com/questions/123456"},"detail_text":"1234 万热度"},{"target":{"title":"","url":"https://api.zhihu.com/questions/1"},"detail_text":""}]}`))
		case "/hackernews":
			_, _ = response.Write([]byte(`{"hits":[{"objectID":"111","title":"Show HN: Panel","url":"","points":256},{"objectID":"222","title":"Fallback link","url":" ","points":10},{"objectID":"","title":"Drop me","url":" ","points":1}]}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	zhihu := NewZhihuProvider(server.URL + "/zhihu")
	items, err := zhihu.Fetch(context.Background(), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one zhihu item, got %#v", items)
	}
	if items[0].URL != "https://www.zhihu.com/question/123456" || items[0].Score != 12340000 {
		t.Fatalf("unexpected zhihu normalization: %#v", items[0])
	}

	hackernews := NewHackerNewsProvider(server.URL + "/hackernews")
	items, err = hackernews.Fetch(context.Background(), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expected two hackernews items, got %#v", items)
	}
	if items[0].URL != "https://news.ycombinator.com/item?id=111" || items[0].Score != 256 {
		t.Fatalf("unexpected hackernews normalization: %#v", items[0])
	}
	if items[1].URL != "https://news.ycombinator.com/item?id=222" {
		t.Fatalf("expected objectID fallback, got %#v", items[1])
	}
}

func TestClientValidatesInputAndSources(t *testing.T) {
	client := NewClient(nil, time.Minute, time.Hour, NewWeiboProvider(DefaultWeiboEndpoint))
	if _, err := client.Get(context.Background(), "unknown", 10); !errors.Is(err, ErrUnknownSource) {
		t.Fatalf("expected unknown source, got %v", err)
	}
	if _, err := client.Get(context.Background(), "weibo", 0); !errors.Is(err, ErrInvalidLimit) {
		t.Fatalf("expected invalid limit, got %v", err)
	}
	if _, err := client.Get(context.Background(), "weibo", 51); !errors.Is(err, ErrInvalidLimit) {
		t.Fatalf("expected invalid limit, got %v", err)
	}

	empty := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"ok":1,"data":{"realtime":[]}}`))
	}))
	defer empty.Close()
	client = NewClient(empty.Client(), time.Minute, time.Hour, NewWeiboProvider(empty.URL))
	if _, err := client.Get(context.Background(), "weibo", 10); !errors.Is(err, ErrSourceEmptied) {
		t.Fatalf("expected emptied source, got %v", err)
	}
}

func TestClientSupportsReplaceableProviders(t *testing.T) {
	now := time.Now()
	client := NewClient(nil, time.Minute, time.Hour, &staticProvider{name: "custom", title: "旧条目"})
	client.now = func() time.Time { return now }
	first, err := client.Get(context.Background(), "custom", 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Items[0].Title != "旧条目" {
		t.Fatalf("unexpected initial item: %#v", first.Items[0])
	}

	now = now.Add(2 * time.Minute)
	client.Register(&staticProvider{name: "custom", title: "新条目"})
	second, err := client.Get(context.Background(), "custom", 10)
	if err != nil {
		t.Fatal(err)
	}
	if second.Items[0].Title != "新条目" || second.Cached {
		t.Fatalf("expected replaced provider result, got %#v", second)
	}
	sources := client.Sources()
	if len(sources) != 1 || sources[0] != "custom" {
		t.Fatalf("unexpected sources: %#v", sources)
	}
}

type staticProvider struct {
	name  string
	title string
}

func (provider *staticProvider) Name() string { return provider.name }

func (provider *staticProvider) Fetch(_ context.Context, _ *http.Client) ([]Item, error) {
	return []Item{{Title: provider.title, URL: "https://example.com/item"}}, nil
}
