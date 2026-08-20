package models

// PublicFile 公共图库文件，管理员维护，所有账号只读使用。
type PublicFile struct {
	BaseModel
	Src      string `json:"src"`
	FileName string `json:"fileName" gorm:"type:varchar(255)"`
	Ext      string `gorm:"type:varchar(255)" json:"ext"`
	Type     string `gorm:"type:varchar(20);default:'other'" json:"type"` // icon/wallpaper/other
	Uploader uint   `json:"uploader"`                                     // 上传管理员 ID
}

// AddPublicFile 添加公共图库文件记录
func (m *PublicFile) AddPublicFile(fileName, ext, src, fileType, uploader string) (PublicFile, error) {
	if fileType == "" {
		fileType = "other"
	}
	file := PublicFile{
		FileName: fileName,
		Src:      src,
		Ext:      ext,
		Type:     fileType,
		Uploader: 0, // 将在 API 层设置
	}
	err := Db.Create(&file).Error
	return file, err
}
