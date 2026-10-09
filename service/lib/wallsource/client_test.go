package wallsource

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestClient(handler http.HandlerFunc) (*Client, *httptest.Server) {
	server := httptest.NewServer(handler)
	endpoints := Endpoints{Bing: server.URL, Konachan: server.URL, Yandere: server.URL}
	return NewClient(server.Client(), endpoints, time.Minute), server
}

func TestValidationRejectsBadParams(t *testing.T) {
	client, server := newTestClient(func(w http.ResponseWriter, r *http.Request) { t.Error("upstream must not be called") })
	defer server.Close()
	for _, params := range []SearchParams{
		{Source: "flickr"},
		{Source: "bing", Page: 101},
		{Source: "unsplash"},
		{Source: "bing", Sorting: "popular"},
		{Source: "konachan", Purity: "000"},
		{Source: "konachan", Purity: "1x0"},
		{Source: "yandere", Query: "a b c d e"},
		{Source: "yandere", Query: "landscape rating:e"},
		{Source: "konachan", Query: "-Rating:s"},
		{Source: "konachan", Query: "order:random"},
	} {
		if _, err := client.Search(context.Background(), params); !errors.Is(err, ErrInvalidParams) {
			t.Fatalf("%+v: expected invalid params, got %v", params, err)
		}
	}
}

func TestBingMergesBothWindows(t *testing.T) {
	client, server := newTestClient(func(w http.ResponseWriter, r *http.Request) {
		day := map[string]string{"0": "20261008", "7": "20261001"}[r.URL.Query().Get("idx")]
		_, _ = w.Write([]byte(`{"images":[{"startdate":"` + day + `","urlbase":"/th?id=OHR.A_` + day + `","title":"T","copyright":"C","copyrightlink":"https://www.bing.com/search?q=x"},{"startdate":"20261001","urlbase":"/th?id=OHR.A_20261001"},{"startdate":"20261000","urlbase":"//evil.example/x"}]}`))
	})
	defer server.Close()
	result, err := client.Search(context.Background(), SearchParams{Source: "bing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.Items[0].Category != "2026-10-08" || result.Items[1].ID != "20261001" {
		t.Fatalf("unexpected items: %+v", result.Items)
	}
	if result.Items[0].RawURL != server.URL+"/th?id=OHR.A_20261008_UHD.jpg" || result.Items[0].ThumbURL != server.URL+"/th?id=OHR.A_20261008_400x240.jpg" {
		t.Fatalf("unexpected image urls: %+v", result.Items[0])
	}
}

func TestUpstreamRateLimitMapsToMessage(t *testing.T) {
	client, server := newTestClient(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTooManyRequests) })
	defer server.Close()
	if _, err := client.Search(context.Background(), SearchParams{Source: "yandere"}); !errors.Is(err, ErrUpstreamRateLimit) {
		t.Fatalf("429: %v", err)
	}
}

func TestBooruTagsRatingsAndCount(t *testing.T) {
	var tags []string
	calls := 0
	client, server := newTestClient(func(w http.ResponseWriter, r *http.Request) {
		calls++
		tags = append(tags, r.URL.Query().Get("tags"))
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<posts count="50" offset="0">
  <post id="9" tags="landscape sky" score="12" file_size="100" jpeg_url="https://files.example/9.jpg" preview_url="https://assets.example/9.jpg" width="3840" height="2160" rating="q" author="a"/>
  <post id="10" tags="tall" jpeg_url="https://files.example/10.jpg" width="1920" height="4000" rating="s"/>
  <post id="11" tags="insecure" jpeg_url="http://files.example/11.jpg" width="3840" height="2160" rating="s"/>
</posts>`))
	})
	defer server.Close()
	result, err := client.Search(context.Background(), SearchParams{Source: "yandere", Query: " landscape ", Purity: "110", Sorting: "score"})
	if err != nil {
		t.Fatal(err)
	}
	if tags[0] != "landscape -rating:e order:score width:1920.." {
		t.Fatalf("unexpected tags %q", tags[0])
	}
	if len(result.Items) != 1 || result.Items[0].Category != "Sketchy" || result.Items[0].Favorites != 12 ||
		result.Items[0].URL != server.URL+"/post/show/9" || result.Meta.Total != 50 || result.Meta.LastPage != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, err := client.Search(context.Background(), SearchParams{Source: "konachan"}); err != nil || tags[1] != "rating:s width:1920.." {
		t.Fatalf("default rating must be SFW: %q %v", tags[1], err)
	}
	cached, err := client.Search(context.Background(), SearchParams{Source: "konachan"})
	if err != nil || !cached.Cached || calls != 2 {
		t.Fatalf("second identical search must hit the cache: calls=%d cached=%v", calls, cached.Cached)
	}
}
