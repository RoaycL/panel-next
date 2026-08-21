package cors

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	allowMethods  = "GET, POST, DELETE, OPTIONS"
	allowHeaders  = "Accept, Accept-Language, Authorization, Content-Type, Lang, Token, X-Panel-API-Version"
	exposeHeaders = "Content-Disposition, X-Panel-API-Min-Version, X-Panel-API-Version"
)

var extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

type Policy struct {
	origins        map[string]struct{}
	allowedHeaders map[string]struct{}
}

// isExtensionOrigin 报告 origin 是否来自一个格式合法的 Chrome 扩展。
// 浏览器无法由普通网页伪造 chrome-extension://<合法ID> 的 Origin，
// 因此任何格式合法的扩展 Origin 都会被自动放行（无需逐个配置 ID）。
func isExtensionOrigin(origin string) bool {
	if !strings.HasPrefix(origin, "chrome-extension://") {
		return false
	}
	id := strings.TrimPrefix(origin, "chrome-extension://")
	return extensionIDPattern.MatchString(id)
}

func NewPolicy(webOrigins, extensionIDs string) (*Policy, error) {
	policy := &Policy{
		origins: make(map[string]struct{}),
		allowedHeaders: headerSet(
			"accept", "accept-language", "authorization", "content-type", "lang", "token", "x-panel-api-version", "x-requested-with",
		),
	}
	for _, configured := range splitList(webOrigins) {
		origin, err := normalizeWebOrigin(configured)
		if err != nil {
			return nil, fmt.Errorf("invalid CORS web origin %q: %w", configured, err)
		}
		policy.origins[origin] = struct{}{}
	}
	for _, id := range splitList(extensionIDs) {
		if id == "*" {
			// * 通配符在旧版配置中曾用于放行所有扩展，新版策略已自动识别
			// 所有格式合法的 Chrome 扩展 Origin，因此此处仅保留兼容性接收。
			continue
		}
		if !extensionIDPattern.MatchString(id) {
			return nil, fmt.Errorf("invalid Chrome extension ID %q", id)
		}
		policy.origins["chrome-extension://"+id] = struct{}{}
	}
	return policy, nil
}

func (p *Policy) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			c.Next()
			return
		}
		allowed := false
		if _, ok := p.origins[origin]; ok {
			allowed = true
		} else if isExtensionOrigin(origin) {
			// 自动放行所有格式合法的 Chrome 扩展 Origin。
			// allowAnyExtension（配置 *）仍保留以兼容旧配置。
			allowed = true
		} else if sameOrigin(c.Request, origin) {
			allowed = true
		}
		if !allowed {
			abortForbidden(c, "origin is not allowed")
			return
		}

		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Expose-Headers", exposeHeaders)
		c.Header("Vary", "Origin")
		if c.Request.Method != http.MethodOptions {
			c.Next()
			return
		}

		if !allowedMethod(c.GetHeader("Access-Control-Request-Method")) {
			abortForbidden(c, "requested method is not allowed")
			return
		}
		if !p.headersAllowed(c.GetHeader("Access-Control-Request-Headers")) {
			abortForbidden(c, "requested headers are not allowed")
			return
		}
		c.Header("Access-Control-Allow-Methods", allowMethods)
		c.Header("Access-Control-Allow-Headers", allowHeaders)
		c.Header("Access-Control-Max-Age", "600")
		c.Status(http.StatusNoContent)
		c.Abort()
	}
}

func sameOrigin(request *http.Request, origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return false
	}
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	} else if forwarded := strings.ToLower(strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-Proto"), ",")[0])); forwarded == "http" || forwarded == "https" {
		scheme = forwarded
	}
	return strings.EqualFold(parsed.Scheme, scheme) && strings.EqualFold(parsed.Host, request.Host)
}

func normalizeWebOrigin(raw string) (string, error) {
	if raw == "*" || strings.EqualFold(raw, "null") {
		return "", fmt.Errorf("wildcard and null origins are forbidden")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("must be an HTTP(S) origin")
	}
	if parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("must not contain credentials, path, query, or fragment")
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), nil
}

func (p *Policy) headersAllowed(raw string) bool {
	for _, header := range strings.Split(raw, ",") {
		header = strings.ToLower(strings.TrimSpace(header))
		if header == "" {
			continue
		}
		if _, ok := p.allowedHeaders[header]; !ok {
			return false
		}
	}
	return true
}

func allowedMethod(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodGet, http.MethodPost, http.MethodDelete:
		return true
	default:
		return false
	}
}

func splitList(raw string) []string {
	seen := make(map[string]struct{})
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	values := make([]string, 0, len(seen))
	for value := range seen {
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func headerSet(headers ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(headers))
	for _, header := range headers {
		set[header] = struct{}{}
	}
	return set
}

func abortForbidden(c *gin.Context, message string) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 1403, "msg": message})
}
