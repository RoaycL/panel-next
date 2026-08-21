package syncApiStructs

import (
	"time"

	"panel-next/models/datatype"
)

const BootstrapSchemaVersion = 1

// BootstrapResponse is the versioned, cacheable first-screen synchronization
// contract. Revision is a base-10 string so JavaScript clients never lose
// precision when the backing database counter grows beyond Number.MAX_SAFE_INTEGER.
type BootstrapResponse struct {
	SchemaVersion int              `json:"schemaVersion"`
	Revision      string           `json:"revision"`
	GeneratedAt   time.Time        `json:"generatedAt"`
	Account       BootstrapAccount `json:"account"`
	Panel         BootstrapPanel   `json:"panel"`
}

type BootstrapAccount struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	HeadImage string `json:"headImage"`
	Role      int    `json:"role"`
	Mail      string `json:"mail"`
	Status    int    `json:"status"`
}

type BootstrapPanel struct {
	Revision     string                 `json:"revision"`
	Config       map[string]interface{} `json:"config"`
	SearchEngine map[string]interface{} `json:"searchEngine"`
	Groups       []BootstrapGroup       `json:"groups"`
}

type BootstrapGroup struct {
	ID          uint            `json:"id"`
	CreateTime  time.Time       `json:"createTime"`
	UpdateTime  time.Time       `json:"updateTime"`
	Icon        string          `json:"icon"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Sort        int             `json:"sort"`
	Revision    string          `json:"revision"`
	Items       []BootstrapItem `json:"items"`
}

type BootstrapItem struct {
	ID              uint                      `json:"id"`
	CreateTime      time.Time                 `json:"createTime"`
	UpdateTime      time.Time                 `json:"updateTime"`
	Icon            datatype.ItemIconIconInfo `json:"icon"`
	Title           string                    `json:"title"`
	URL             string                    `json:"url"`
	LANURL          string                    `json:"lanUrl"`
	Description     string                    `json:"description"`
	OpenMethod      int                       `json:"openMethod"`
	Sort            int                       `json:"sort"`
	Revision        string                    `json:"revision"`
	ItemIconGroupID uint                      `json:"itemIconGroupId"`
}
