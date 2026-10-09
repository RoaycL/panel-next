package imgbed

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListParsesIndexedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/manage/list" || r.Header.Get("Authorization") != "Bearer tok" || r.URL.Query().Get("start") != "20" {
			t.Errorf("unexpected request %s %s", r.URL.String(), r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"files":[{"name":"wall/a b.jpg","metadata":{"FileType":"image/jpeg"}},{"name":"doc.pdf","metadata":{"FileType":"application/pdf"}}],"totalCount":41}`))
	}))
	defer server.Close()

	result, err := NewClient().List(context.Background(), Config{BaseURL: server.URL + "/", Token: "tok"}, 20, 20)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 41 || len(result.Items) != 1 || result.Items[0].URL != server.URL+"/file/wall/a%20b.jpg" {
		t.Fatalf("unexpected result %+v", result)
	}
}

func TestListLegacyArrayAndForbidden(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`[{"name":"x.png","metadata":{}},{"name":"y.webp","metadata":{}}]`))
	}))
	defer server.Close()
	cfg := Config{BaseURL: server.URL, Token: "tok"}

	result, err := NewClient().List(context.Background(), cfg, 0, 2)
	if err != nil || len(result.Items) != 2 || result.Total != 3 {
		t.Fatalf("legacy list: %+v %v", result, err)
	}
	status = http.StatusUnauthorized
	if _, err := NewClient().List(context.Background(), cfg, 0, 2); !errors.Is(err, ErrListForbidden) {
		t.Fatalf("want ErrListForbidden, got %v", err)
	}
}
