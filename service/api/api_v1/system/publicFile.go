package system

import (
	"fmt"
	"os"
	"path"
	"strings"
	"sun-panel/api/api_v1/common/apiData/commonApiStructs"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	"sun-panel/lib/cmn"
	"sun-panel/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"gorm.io/gorm"
)

type PublicFileApi struct{}

// Upload 管理员上传公共图库图片
func (a *PublicFileApi) Upload(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	configUpload := global.Config.GetValueString("base", "source_path")
	f, err := c.FormFile("imgfile")
	if err != nil {
		apiReturn.ErrorByCode(c, 1300)
		return
	}

	fileExt := strings.ToLower(path.Ext(f.Filename))
	agreeExts := []string{".png", ".jpg", ".gif", ".jpeg", ".webp", ".svg", ".ico", ".avif"}
	if !cmn.InArray(agreeExts, fileExt) {
		apiReturn.ErrorByCode(c, 1301)
		return
	}

	fileType := c.PostForm("fileType")
	if fileType != "icon" && fileType != "wallpaper" {
		fileType = "other"
	}

	fileName := cmn.Md5(fmt.Sprintf("%s%s", f.Filename, time.Now().String()))
	fildDir := fmt.Sprintf("%s/%d/%d/%d/", configUpload, time.Now().Year(), time.Now().Month(), time.Now().Day())
	isExist, _ := cmn.PathExists(fildDir)
	if !isExist {
		os.MkdirAll(fildDir, os.ModePerm)
	}
	filepath := fmt.Sprintf("%s%s%s", fildDir, fileName, fileExt)
	c.SaveUploadedFile(f, filepath)

	mFile := models.PublicFile{}
	mFile.FileName = f.Filename
	mFile.Src = filepath
	mFile.Ext = fileExt
	mFile.Type = fileType
	mFile.Uploader = userInfo.ID
	if err := global.Db.Create(&mFile).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}

	apiReturn.SuccessData(c, gin.H{
		"imageUrl": filepath[1:],
		"type":     fileType,
	})
}

// GetList 查询公共图库列表（所有登录用户可读）
func (a *PublicFileApi) GetList(c *gin.Context) {
	list := []models.PublicFile{}
	var count int64

	fileType := c.Query("type")
	query := global.Db.Model(&models.PublicFile{})
	if fileType != "" {
		query = query.Where("type=?", fileType)
	}

	if err := query.Order("created_at desc").Find(&list).Count(&count).Error; err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}

	data := []map[string]interface{}{}
	for _, v := range list {
		data = append(data, map[string]interface{}{
			"src":        v.Src[1:],
			"fileName":   v.FileName,
			"id":         v.ID,
			"createTime": v.CreatedAt,
			"type":       v.Type,
		})
	}
	apiReturn.SuccessListData(c, data, count)
}

// Deletes 管理员删除公共图库文件
func (a *PublicFileApi) Deletes(c *gin.Context) {
	req := commonApiStructs.RequestDeleteIds[uint]{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}

	global.Db.Transaction(func(tx *gorm.DB) error {
		files := []models.PublicFile{}
		if err := tx.Find(&files, "id in ?", req.Ids).Error; err != nil {
			return err
		}
		for _, v := range files {
			os.Remove(v.Src)
		}
		if err := tx.Delete(&files, "id in ?", req.Ids).Error; err != nil {
			return err
		}
		return nil
	})

	apiReturn.Success(c)
}

// UpdateType 管理员修改公共图库文件类型
func (a *PublicFileApi) UpdateType(c *gin.Context) {
	req := struct {
		ID   uint   `json:"id"`
		Type string `json:"type"`
	}{}
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return
	}
	if req.Type != "icon" && req.Type != "wallpaper" && req.Type != "other" {
		apiReturn.ErrorParamFomat(c, "type")
		return
	}

	result := global.Db.Model(&models.PublicFile{}).Where("id = ?", req.ID).Update("type", req.Type)
	if result.Error != nil {
		apiReturn.ErrorDatabase(c, result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		apiReturn.ErrorDataNotFound(c)
		return
	}
	apiReturn.Success(c)
}
