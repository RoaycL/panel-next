package panel

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

const (
	maxThemeConfigBytes    = 32 << 10
	maxThemeOverridesBytes = 32 << 10
	maxThemeEnvelopeBytes  = 64 << 10
)

var (
	// 与前端 src/themes/constants.ts THEME_ID_PATTERN 完全一致：
	// 小写字母/数字开头，仅小写字母、数字、点、连字符，1~64 字符。
	themeIDPattern       = regexp.MustCompile(`^[a-z\d][a-z\d.-]{0,63}$`)
	themeIconPackPattern = regexp.MustCompile(`^[a-z\d][a-z\d.-]{0,63}$`)
)

func validThemeVariantValue(key string, value interface{}) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	switch key {
	case "bookmark":
		return text == "glass" || text == "solid" || text == "minimal"
	case "widget":
		return text == "glass" || text == "solid" || text == "borderless"
	case "sidebar":
		return text == "floating" || text == "attached" || text == "minimal"
	case "search":
		return text == "pill" || text == "box" || text == "underline"
	default:
		return false
	}
}

// validatePanelTheme 对 panelConfig.theme 做无状态结构校验。
// 规则与前端 src/themes/schema.ts#validateThemeWireSelection 保持一致；
// 字节口径统一为 Go json.Marshal（<、>、&、U+2028、U+2029 转义为 \uXXXX）。
func validatePanelTheme(panel map[string]interface{}) error {
	if panel == nil {
		return nil
	}
	raw, exists := panel["theme"]
	if !exists || raw == nil {
		return nil
	}
	envelope, err := json.Marshal(raw)
	if err != nil || len(envelope) > maxThemeEnvelopeBytes {
		return errors.New("theme selection exceeds 64 KiB")
	}
	selection, ok := raw.(map[string]interface{})
	if !ok {
		return errors.New("theme selection must be an object")
	}
	if integer(selection["schemaVersion"]) != 1 {
		return errors.New("unsupported theme selection schema version")
	}
	themeID, idOK := selection["themeId"].(string)
	if !idOK || !themeIDPattern.MatchString(themeID) {
		return fmt.Errorf("theme %q has an invalid theme id", themeID)
	}
	if v := integer(selection["themeVersion"]); v < 1 || v > maxJavaScriptSafeInteger {
		return fmt.Errorf("theme %q has an invalid version", themeID)
	}
	mode, modeOK := selection["mode"].(string)
	if !modeOK {
		return fmt.Errorf("theme %q has an invalid mode", themeID)
	}
	switch mode {
	case "light", "dark", "auto":
	default:
		return fmt.Errorf("theme %q has an invalid mode", themeID)
	}
	if raw, exists := selection["wallpapers"]; exists {
		wallpapers, ok := raw.(map[string]interface{})
		if !ok || len(wallpapers) > 50 {
			return errors.New("invalid theme wallpaper map")
		}
		for id, rawPair := range wallpapers {
			if !themeIDPattern.MatchString(id) {
				return errors.New("invalid wallpaper theme id")
			}
			pair, ok := rawPair.(map[string]interface{})
			if !ok {
				return errors.New("wallpapers must be an object")
			}
			for mode, rawURL := range pair {
				if mode != "light" && mode != "dark" {
					return errors.New("invalid wallpaper mode")
				}
				text, ok := rawURL.(string)
				if !ok || len(text) > 4096 || strings.Contains(text, "\\") || strings.IndexFunc(text, func(r rune) bool { return r <= 32 }) >= 0 {
					return errors.New("invalid wallpaper URL")
				}
				if text == "" || (strings.HasPrefix(text, "/") && !strings.HasPrefix(text, "//")) {
					continue
				}
				parsed, err := url.Parse(text)
				if err != nil || (strings.ToLower(parsed.Scheme) != "http" && strings.ToLower(parsed.Scheme) != "https") || parsed.Hostname() == "" || parsed.User != nil {
					return errors.New("invalid wallpaper URL")
				}
			}
		}
	}
	if config, exists := selection["config"]; exists && config != nil {
		configJSON, err := json.Marshal(config)
		if err != nil || len(configJSON) > maxThemeConfigBytes {
			return fmt.Errorf("theme %q config exceeds 32 KiB", themeID)
		}
		if _, ok := config.(map[string]interface{}); !ok {
			return fmt.Errorf("theme %q config must be an object", themeID)
		}
	}
	if overrides, exists := selection["overrides"]; exists && overrides != nil {
		overridesJSON, err := json.Marshal(overrides)
		if err != nil || len(overridesJSON) > maxThemeOverridesBytes {
			return fmt.Errorf("theme %q overrides exceed 32 KiB", themeID)
		}
		if _, ok := overrides.(map[string]interface{}); !ok {
			return fmt.Errorf("theme %q overrides must be an object", themeID)
		}
	}
	if variants, exists := selection["variants"]; exists && variants != nil {
		variantMap, ok := variants.(map[string]interface{})
		if !ok {
			return fmt.Errorf("theme %q variants must be an object", themeID)
		}
		for key, value := range variantMap {
			if !validThemeVariantValue(key, value) {
				return fmt.Errorf("theme %q has an invalid variant %q", themeID, key)
			}
		}
	}
	if iconPack, exists := selection["iconPackId"]; exists && iconPack != nil {
		iconPackID, ok := iconPack.(string)
		if !ok || !themeIconPackPattern.MatchString(iconPackID) {
			return fmt.Errorf("theme %q has an invalid icon pack id", themeID)
		}
	}
	return nil
}
