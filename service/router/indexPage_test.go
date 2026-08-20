package router

import (
	"strings"
	"testing"
)

const sampleIndexHTML = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<link rel="icon" type="image/svg+xml" href="/favicon.svg">
	<link rel="stylesheet"  href="/custom/index.css">
	<title>Sun-Panel</title>
</head>
<body>
	<script src="/custom/index.js"></script>
</body>
</html>`

func TestInjectSiteBrandingReplacesTitleAndFavicon(t *testing.T) {
	result := injectSiteBranding(sampleIndexHTML, "我的导航", "/uploads/2026/8/20/icon.ico", "", "")
	if !strings.Contains(result, "<title>我的导航</title>") {
		t.Fatalf("title was not injected: %s", result)
	}
	if !strings.Contains(result, `<link rel="icon" href="/uploads/2026/8/20/icon.ico">`) {
		t.Fatalf("favicon was not injected: %s", result)
	}
	if strings.Contains(result, "/favicon.svg") {
		t.Fatalf("default favicon remained: %s", result)
	}
}

func TestInjectSiteBrandingEscapesValues(t *testing.T) {
	result := injectSiteBranding(sampleIndexHTML, `A<B>"C"&D`, "/x.ico", "", "")
	if !strings.Contains(result, "<title>A&lt;B&gt;&#34;C&#34;&amp;D</title>") {
		t.Fatalf("title was not escaped: %s", result)
	}

	// href 中的引号必须转义，防止逃逸属性注入
	malformed := injectSiteBranding(sampleIndexHTML, "T", `/a" onerror="alert(1)`, "", "")
	if strings.Contains(result, `onerror=`) || !strings.Contains(malformed, `href="/a&#34; onerror=&#34;alert(1)"`) {
		t.Fatalf("favicon href was not escaped: %s", malformed)
	}
}

func TestInjectSiteBrandingKeepsDefaultsWhenUnset(t *testing.T) {
	result := injectSiteBranding(sampleIndexHTML, "", "", "", "")
	if !strings.Contains(result, "<title>Sun-Panel</title>") {
		t.Fatalf("default title was modified: %s", result)
	}
	if !strings.Contains(result, "/favicon.svg") {
		t.Fatalf("default favicon was modified: %s", result)
	}
	if !strings.Contains(result, `/custom/index.css`) {
		t.Fatalf("default CSS file ref was removed: %s", result)
	}
	if !strings.Contains(result, `/custom/index.js`) {
		t.Fatalf("default JS file ref was removed: %s", result)
	}
}

func TestInjectSiteBrandingAddsFaviconWhenTemplateHasNone(t *testing.T) {
	noFavicon := `<!DOCTYPE html><html><head><title>Sun-Panel</title></head></html>`
	result := injectSiteBranding(noFavicon, "T", "/f.ico", "", "")
	if !strings.Contains(result, `<link rel="icon" href="/f.ico"><title>`) {
		t.Fatalf("favicon was not prepended: %s", result)
	}
}

func TestInjectSiteBrandingInlinesGlobalScriptsAndKeepsFilesWhenEmpty(t *testing.T) {
	// DB 有值：内联替换 /custom/index.* 引用
	result := injectSiteBranding(sampleIndexHTML, "", "", "body{color:red}", "console.log(1)")
	if !strings.Contains(result, "<style>\nbody{color:red}\n</style>") {
		t.Fatalf("global CSS was not inlined: %s", result)
	}
	if !strings.Contains(result, "<script>\nconsole.log(1)\n</script>") {
		t.Fatalf("global JS was not inlined: %s", result)
	}
	if strings.Contains(result, `/custom/index.css`) || strings.Contains(result, `/custom/index.js`) {
		t.Fatalf("file references should be replaced by inlined scripts: %s", result)
	}

	// DB 无值：保留文件方式
	empty := injectSiteBranding(sampleIndexHTML, "", "", "", "")
	if !strings.Contains(empty, `/custom/index.css`) || !strings.Contains(empty, `/custom/index.js`) {
		t.Fatalf("file references should be kept when DB is empty: %s", empty)
	}
}
