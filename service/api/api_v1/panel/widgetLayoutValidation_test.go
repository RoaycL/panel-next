package panel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validWidgetLayout() map[string]interface{} {
	return map[string]interface{}{
		"widgets": map[string]interface{}{
			"schemaVersion": float64(1),
			"widgets": []interface{}{map[string]interface{}{
				"id": "core.date.1", "type": "core.date", "version": float64(1),
				"position": map[string]interface{}{"column": float64(0), "row": float64(0)},
				"size":     map[string]interface{}{"columns": float64(3), "rows": float64(1)},
				"hidden":   false, "config": map[string]interface{}{},
			}},
		},
	}
}

func TestValidatePanelWidgetLayout(t *testing.T) {
	if err := validatePanelWidgetLayout(validWidgetLayout()); err != nil {
		t.Fatalf("valid layout rejected: %v", err)
	}
	panel := validWidgetLayout()
	widgets := panel["widgets"].(map[string]interface{})["widgets"].([]interface{})
	widgets = append(widgets, widgets[0])
	panel["widgets"].(map[string]interface{})["widgets"] = widgets
	if err := validatePanelWidgetLayout(panel); err == nil || !strings.Contains(err.Error(), "duplicated") {
		t.Fatalf("duplicate widget was not rejected: %v", err)
	}
}

func TestValidatePanelWidgetLayoutLimits(t *testing.T) {
	panel := validWidgetLayout()
	widget := panel["widgets"].(map[string]interface{})["widgets"].([]interface{})[0].(map[string]interface{})
	widget["config"] = map[string]interface{}{"text": strings.Repeat("x", maxWidgetConfigBytes)}
	if err := validatePanelWidgetLayout(panel); err == nil {
		t.Fatal("oversized widget config was not rejected")
	}
}

// TestWireContractSamples 消费与 TypeScript 侧（scripts/validate-widget-registry.mjs）
// 完全相同的共享样本，防止前后端传输契约规则漂移。
func TestWireContractSamples(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "scripts", "fixtures", "widget-wire-samples.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Instances []struct {
			Name           string `json:"name"`
			Expect         string `json:"expect"`
			SynthesizeBlob *struct {
				Codepoint int `json:"codepoint"`
				Repeat    int `json:"repeat"`
			} `json:"synthesizeBlob"`
			Instance json.RawMessage `json:"instance"`
		} `json:"instances"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(fixture.Instances) == 0 {
		t.Fatal("fixture contains no samples")
	}
	for _, sample := range fixture.Instances {
		t.Run(sample.Name, func(t *testing.T) {
			var instanceRaw interface{}
			if err := json.Unmarshal(sample.Instance, &instanceRaw); err != nil {
				t.Fatalf("decode instance: %v", err)
			}
			if instance, ok := instanceRaw.(map[string]interface{}); ok && sample.SynthesizeBlob != nil {
				blob := strings.Repeat(string(rune(sample.SynthesizeBlob.Codepoint)), sample.SynthesizeBlob.Repeat)
				instance["config"] = map[string]interface{}{"blob": blob}
			}
			panel := map[string]interface{}{
				"widgets": map[string]interface{}{
					"schemaVersion": float64(1),
					"widgets":       []interface{}{instanceRaw},
				},
			}
			err := validatePanelWidgetLayout(panel)
			switch sample.Expect {
			case "valid":
				if err != nil {
					t.Fatalf("expected valid, server rejected: %v", err)
				}
			case "invalid":
				if err == nil {
					t.Fatal("expected invalid, server accepted")
				}
			default:
				t.Fatalf("unknown expect %q in sample %s", sample.Expect, sample.Name)
			}
		})
	}
}
