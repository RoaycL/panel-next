package siteFavicon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

var testPNG = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00")

func TestAcquireRedirectRelativeQueryAndCandidates(t *testing.T) {
	pageReads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/start":
			http.Redirect(w, r, "/app/page", http.StatusFound)
		case "/app/page":
			pageReads++
			w.Write([]byte(`<link rel="icon" href="bad.png"><link rel="ICON" href="../good?token=keep"><link rel="icon" href="../good?token=keep">`))
		case "/app/bad.png":
			w.Write([]byte(`<html>Login required</html>`))
		case "/good":
			if r.URL.Query().Get("token") != "keep" {
				t.Error("query parameter lost")
			}
			w.Write(testPNG)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	file, candidates, err := Acquire(context.Background(), server.URL+"/start", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if pageReads != 1 {
		t.Fatalf("page fetched %d times", pageReads)
	}
	if len(candidates) != 3 || candidates[1] != server.URL+"/good?token=keep" {
		t.Fatalf("bad candidates: %v", candidates)
	}
	if !strings.HasSuffix(file.Name(), ".png") {
		t.Fatalf("unexpected extension: %s", file.Name())
	}
	data, err := os.ReadFile(file.Name())
	if err != nil || string(data) != string(testPNG) {
		t.Fatal("saved icon mismatch")
	}
}

func TestAcquireFallbackAndBaseHref(t *testing.T) {
	for _, mode := range []string{"missing", "blocked", "base"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/favicon.ico" || r.URL.Path == "/assets/icon.png" {
					w.Write(testPNG)
					return
				}
				if mode == "blocked" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				if mode == "base" {
					w.Write([]byte(`<base href="/assets/"><link rel="icon" href="icon.png">`))
					return
				}
				w.Write([]byte(`<html>No icon declaration</html>`))
			}))
			defer server.Close()
			_, urls, err := Acquire(context.Background(), server.URL+"/page", t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if mode == "base" && urls[0] != server.URL+"/assets/icon.png" {
				t.Fatalf("base href ignored: %v", urls)
			}
		})
	}
}

func TestAcquireRejectsHTMLAndInvalidURLs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`<html>challenge</html>`)) }))
	defer server.Close()
	dir := t.TempDir()
	if _, _, err := Acquire(context.Background(), server.URL, dir); err == nil || !strings.Contains(err.Error(), "不是图片") {
		t.Fatalf("expected image error: %v", err)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 0 {
		t.Fatal("invalid response must not leave a file")
	}
	for _, invalid := range []string{"file:///tmp/icon", "localhost", "https://user:pass@example.com"} {
		if _, _, err := Acquire(context.Background(), invalid, dir); err == nil {
			t.Fatalf("accepted invalid URL %s", invalid)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := Acquire(ctx, server.URL, dir); err == nil {
		t.Fatal("canceled request accepted")
	}
}

func TestAcquireDeadlineAndOversizedResponse(t *testing.T) {
	t.Run("deadline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
		defer server.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		defer cancel()
		if _, _, err := Acquire(ctx, server.URL, t.TempDir()); err == nil || !strings.Contains(err.Error(), "超时") {
			t.Fatalf("deadline not respected: %v", err)
		}
	})
	t.Run("oversized", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				w.Write([]byte(`<link rel="icon" href="/big.png">`))
				return
			}
			w.Write(append(testPNG, make([]byte, 1<<20)...))
		}))
		defer server.Close()
		dir := t.TempDir()
		if _, _, err := Acquire(context.Background(), server.URL, dir); err == nil || !strings.Contains(err.Error(), "1 MB") {
			t.Fatalf("size bound not respected: %v", err)
		}
		files, _ := os.ReadDir(dir)
		if len(files) != 0 {
			t.Fatal("oversized icon left a file")
		}
	})
}
