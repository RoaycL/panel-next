package datatype

type ItemIconIconInfo struct {
	ItemType        int    `json:"itemType"`
	Src             string `json:"src"`
	Text            string `json:"text"`
	BackgroundColor string `json:"backgroundColor"`
	DockerContainerId string `json:"dockerContainerId,omitempty"` // Docker 容器 ID，用于 Docker 卡片类型
}
