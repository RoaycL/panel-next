package panel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestValidatePanelTheme 基础规则验证。
func TestValidatePanelTheme(t *testing.T) {
	if err := validatePanelTheme(nil); err != nil {
		t.Fatalf("nil panel must pass: %v", err)
	}
	if err := validatePanelTheme(map[string]interface{}{}); err != nil {
		t.Fatalf("panel without theme must pass: %v", err)
	}
	valid := map[string]interface{}{
		"theme": map[string]interface{}{
			"schemaVersion": float64(1),
			"themeId":       "core.default",
			"themeVersion":  float64(1),
			"mode":          "auto",
		},
	}
	if err := validatePanelTheme(valid); err != nil {
		t.Fatalf("valid selection rejected: %v", err)
	}
	valid["theme"].(map[string]interface{})["variants"] = map[string]interface{}{
		"bookmark": "glass", "widget": "solid", "sidebar": "floating", "search": "pill",
	}
	if err := validatePanelTheme(valid); err != nil {
		t.Fatalf("valid variants rejected: %v", err)
	}
}

func TestValidatePanelThemeLimits(t *testing.T) {
	panel := map[string]interface{}{
		"theme": map[string]interface{}{
			"schemaVersion": float64(1),
			"themeId":       "core.default",
			"themeVersion":  float64(1),
			"mode":          "light",
			"config":        map[string]interface{}{"text": strings.Repeat("x", maxThemeConfigBytes)},
		},
	}
	if err := validatePanelTheme(panel); err == nil {
		t.Fatal("oversized theme config was not rejected")
	}
}

// TestThemeWireContractSamples 消费与 TypeScript 侧（scripts/validate-theme-registry.mjs）
// 完全相同的共享样本，防止前后端主题传输契约漂移。
func TestThemeWireContractSamples(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "scripts", "fixtures", "theme-wire-samples.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Selections []struct {
			Name           string `json:"name"`
			Expect         string `json:"expect"`
			SynthesizeBlob *struct {
				Codepoint int `json:"codepoint"`
				Repeat    int `json:"repeat"`
			} `json:"synthesizeBlob"`
			Selection json.RawMessage `json:"selection"`
		} `json:"selections"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(fixture.Selections) == 0 {
		t.Fatal("fixture contains no samples")
	}
	for _, sample := range fixture.Selections {
		sample := sample
		t.Run(sample.Name, func(t *testing.T) {
			var selectionRaw interface{}
			if err := json.Unmarshal(sample.Selection, &selectionRaw); err != nil {
				t.Fatalf("decode selection: %v", err)
			}
			selection, ok := selectionRaw.(map[string]interface{})
			if !ok {
				t.Fatalf("selection sample must be an object")
			}
			if sample.SynthesizeBlob != nil {
				blob := strings.Repeat(string(rune(sample.SynthesizeBlob.Codepoint)), sample.SynthesizeBlob.Repeat)
				selection["config"] = map[string]interface{}{"blob": blob}
			}
			err := validatePanelTheme(map[string]interface{}{"theme": selection})
			switch {
			case sample.Expect == "valid" && err != nil:
				t.Fatalf("expected valid, got error: %v", err)
			case sample.Expect == "invalid" && err == nil:
				t.Fatalf("expected invalid, but validation passed")
			}
		})
	}
}
