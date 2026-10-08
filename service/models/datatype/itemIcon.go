package datatype

import "encoding/json"

type ItemIconIconInfo struct {
	ItemType          int     `json:"itemType"`
	Src               string  `json:"src"`
	Text              string  `json:"text"`
	BackgroundColor   string  `json:"backgroundColor"`
	Scale             float64 `json:"scale,omitempty"`             // Content zoom; zero preserves legacy size.
	DockerContainerId string  `json:"dockerContainerId,omitempty"` // Docker 容器 ID，用于 Docker 卡片类型
	Surface           string  `json:"surface,omitempty"`           // "glass" adds a frosted tile; empty shows the icon as is.
}

// UnmarshalJSON drops unknown surface values, so every write path (panel,
// batch add, OpenAPI) stores only "" or "glass" and clients never receive
// an icon their snapshot validator rejects.
func (i *ItemIconIconInfo) UnmarshalJSON(data []byte) error {
	type plain ItemIconIconInfo
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.Surface != "glass" {
		decoded.Surface = ""
	}
	*i = ItemIconIconInfo(decoded)
	return nil
}
