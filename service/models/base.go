package models

import (
	"time"

	_ "gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// int类型代表是否的常量
const (
	INT_FALSE = iota
	INT_TURE
)

type BaseModel struct {
	gorm.Model
	// Db *gorm.DB `gorm:"_"`
	ID        uint      `gorm:"primarykey" json:"id"`
	CreatedAt time.Time `json:"createTime"`
	UpdatedAt time.Time `json:"updateTime"`
	// DeletedAt DeletedAt `gorm:"index"`
}

type BaseModelNoId struct {
	CreatedAt time.Time      `json:"createTime"`
	UpdatedAt time.Time      `json:"updateTime"`
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// 分页的结构体
type PageLimitStruct struct {
	PageSize  int `gorm:"-"` //
	LimitSize int `gorm:"-"` //
}

// 计算分页
func calcPage(page_size, limit_size int) (offset, limit int) {
	offset = limit_size * (page_size - 1)
	limit = limit_size
	return
}

// Db 全局数据库连接
var Db *gorm.DB

// // 日志
// func GetLogger() logger.Interface {
// 	return logger.New(
// 		log.New(os.Stdout, "\r\n", log.LstdFlags), // io writer（日志输出的目标，前缀和日志包含的内容——译者注）
// 		logger.Config{
// 			SlowThreshold:             time.Second, // 慢 SQL 阈值
// 			LogLevel:                  logger.Warn, // 日志级别
// 			IgnoreRecordNotFoundError: true,        // 忽略ErrRecordNotFound（记录未找到）错误
// 			Colorful:                  true,        // 彩色打印
// 		},
// 	)

// }
