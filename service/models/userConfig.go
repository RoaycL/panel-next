package models

import "time"

type UserConfig struct {
	UserId    uint      `gorm:"primaryKey" json:"userId"`
	Revision  int64     `gorm:"not null;default:0;index" json:"-"`
	UpdatedAt time.Time `json:"updateTime"`

	// 纯前端数据，面板样式数据
	PanelJson string                 `json:"-"`
	Panel     map[string]interface{} `gorm:"-" json:"panel"`

	// 搜索引擎
	SearchEngineJson string                 `json:"-"`
	SearchEngine     map[string]interface{} `gorm:"-" json:"searchEngine"`
}
