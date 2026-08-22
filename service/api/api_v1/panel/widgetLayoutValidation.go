package panel

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
)

const (
	maxUserConfigRequestBytes = 1 << 20
	maxWidgetLayoutBytes      = 256 << 10
	maxWidgetConfigBytes      = 32 << 10
	maxWidgetInstances        = 100
	// 与前端 Number.MAX_SAFE_INTEGER 对齐：超出后 JS 端无法精确表示，
	// 会导致双端契约漂移（前端拒绝、后端接受）。
	maxJavaScriptSafeInteger = int64(1)<<53 - 1
)

var (
	widgetIDPattern   = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
	widgetTypePattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,63}$`)
)

func validatePanelWidgetLayout(panel map[string]interface{}) error {
	if panel == nil {
		return nil
	}
	raw, exists := panel["widgets"]
	if !exists || raw == nil {
		return nil
	}
	if size, err := json.Marshal(raw); err != nil || len(size) > maxWidgetLayoutBytes {
		return errors.New("widget layout exceeds 256 KiB")
	}
	layout, ok := raw.(map[string]interface{})
	if !ok || integer(layout["schemaVersion"]) != 1 {
		return errors.New("unsupported widget layout schema")
	}
	widgets, ok := layout["widgets"].([]interface{})
	if !ok || len(widgets) > maxWidgetInstances {
		return errors.New("widget layout must contain at most 100 widgets")
	}
	ids := make(map[string]struct{}, len(widgets))
	for index, rawWidget := range widgets {
		widget, ok := rawWidget.(map[string]interface{})
		if !ok {
			return fmt.Errorf("widget %d must be an object", index)
		}
		id, idOK := widget["id"].(string)
		typeName, typeOK := widget["type"].(string)
		if !idOK || !widgetIDPattern.MatchString(id) || !typeOK || !widgetTypePattern.MatchString(typeName) {
			return fmt.Errorf("widget %d has an invalid identity", index)
		}
		if _, duplicate := ids[id]; duplicate {
			return fmt.Errorf("widget %q is duplicated", id)
		}
		ids[id] = struct{}{}
		if v := integer(widget["version"]); v < 1 || v > maxJavaScriptSafeInteger {
			return fmt.Errorf("widget %q has an invalid version", id)
		}
		position, positionOK := widget["position"].(map[string]interface{})
		size, sizeOK := widget["size"].(map[string]interface{})
		if !positionOK || !gridInteger(position["column"], 0, 10000) || !gridInteger(position["row"], 0, 10000) {
			return fmt.Errorf("widget %q has an invalid position", id)
		}
		if !sizeOK || !gridInteger(size["columns"], 1, 12) || !gridInteger(size["rows"], 1, 24) {
			return fmt.Errorf("widget %q has an invalid size", id)
		}
		if hidden, exists := widget["hidden"]; exists {
			if _, ok := hidden.(bool); !ok {
				return fmt.Errorf("widget %q has an invalid hidden flag", id)
			}
		}
		configJSON, err := json.Marshal(widget["config"])
		if err != nil || len(configJSON) > maxWidgetConfigBytes {
			return fmt.Errorf("widget %q config exceeds 32 KiB", id)
		}
	}
	return nil
}

func integer(value interface{}) int64 {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) || number > math.MaxInt64 || number < math.MinInt64 {
		return -1
	}
	return int64(number)
}

func gridInteger(value interface{}, minimum, maximum int64) bool {
	number := integer(value)
	return number >= minimum && number <= maximum
}
