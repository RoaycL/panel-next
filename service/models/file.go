package models

type File struct {
	BaseModel
	Src      string `json:"src"`
	UserId   uint   `json:"userId"`
	FileName string `json:"fileName" gorm:"type:varchar(255)"` // 文件名
	Method   int    `json:"method"`                            // 上传方式
	Ext      string `gorm:"type:varchar(255)" json:"ext"`      // 扩展名
	Type     string `gorm:"type:varchar(20);default:'other'" json:"type"` // 图片类型：icon/wallpaper/other
}

// 添加一个文件记录
func (m *File) AddFile(userId uint, fileName, ext, src string) (File, error) {
	file := File{
		UserId:   userId,
		FileName: fileName,
		Src:      src,
		Ext:      ext,
		Type:     "other",
	}
	err := Db.Create(&file).Error

	return file, err
}

// 添加一个文件记录（带类型）
func (m *File) AddFileWithType(userId uint, fileName, ext, src, fileType string) (File, error) {
	if fileType == "" {
		fileType = "other"
	}
	file := File{
		UserId:   userId,
		FileName: fileName,
		Src:      src,
		Ext:      ext,
		Type:     fileType,
	}
	err := Db.Create(&file).Error

	return file, err
}
