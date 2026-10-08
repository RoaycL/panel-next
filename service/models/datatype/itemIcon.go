package datatype

type ItemIconIconInfo struct {
	ItemType          int     `json:"itemType"`
	Src               string  `json:"src"`
	Text              string  `json:"text"`
	BackgroundColor   string  `json:"backgroundColor"`
	Scale             float64 `json:"scale,omitempty"`             // Content zoom; zero preserves legacy size.
	DockerContainerId string  `json:"dockerContainerId,omitempty"` // Docker 容器 ID，用于 Docker 卡片类型
	Surface           string  `json:"surface,omitempty"`           // "glass" adds a frosted tile; empty shows the icon as is.
}
