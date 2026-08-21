package cmn

import (
	// "calendar-note-gin/assets"
	"crypto/md5"
	"encoding/hex"
	"math/rand"
	"os"
	"path"
	"strconv"
	"strings"
	"sun-panel/assets"
	"time"
)

const (
	// 时间格式

	TimeFormatMode1         = "2006-01-02 15:04:05" // 标准格式
	TimeFormatMode4         = "2006-01-02 15:04"    // 标准格式 无秒
	TimeFormatMode2         = "Mon Jan 2 15:04:05 -0700 MST 2006"
	TimeFormatMode3         = "Mon, 2 Jan 2006 15:04:05 -0700 MST" // webdav格式
	TimeYYYY_mm_dd          = "2006-01-02"
	TIME_MODE_REMINDER_TIME = "200601021504" // 提醒定时器的执行时间格式

	// 随机码字典

	RAND_CODE_MODE1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" // 大写，小写，数字
	RAND_CODE_MODE2 = "abcdefghijklmnopqrstuvwxyz0123456789"                           // 小写，数字
	RAND_CODE_MODE3 = "0123456789"                                                     // 数字
)

type Version_Info struct {
	Version      string
	Version_code int
}

func GetTime() string {
	return time.Unix(time.Now().Unix(), 0).Format(TimeFormatMode1)
}

// 字符串转时间
func StrToTime(timeMode, formatTimeStr string) (t time.Time, err error) {
	loc, err := time.LoadLocation("Local")
	if err != nil {
		return
	}
	t, err = time.ParseInLocation(timeMode, formatTimeStr, loc) //使用模板在对应时区转化为time.time类型
	return
}

// md5获取
func Md5(str string) string {
	md5Byte := md5.Sum([]byte(str))
	return hex.EncodeToString(md5Byte[:])
}

// 随机生成编码
// 随机码字典内容 参考常量 RAND_CODE_MODE*
func BuildRandCode(count int, secret_content string) (code string) {
	return BuildRandCodeBySeed(count, secret_content, time.Now().UnixNano()+int64(rand.Intn(100)))
}

// 随机生成编码 参考常量 RAND_CODE_MODE*
func BuildRandCodeBySeed(count int, secret_content string, seed int64) (code string) {
	if secret_content == "" {
		secret_content = RAND_CODE_MODE1
	}
	rng := rand.New(rand.NewSource(seed))
	for i := 0; i < count; i++ {
		code += string(secret_content[rng.Intn(len(secret_content))])
	}
	return code
}

// 字符串转int
func StrToInt(str string) int {
	intStr, _ := strconv.Atoi(str)
	return intStr
}

// uint 转string
func UintToStr(c uint) string {
	return strconv.FormatUint(uint64(c), 10)
}

// 获取系统信息
func GetSysVersionInfo() Version_Info {
	cBytes, _ := assets.Asset("assets/version")
	c := string(cBytes)
	info := strings.Split(c, "|")

	return Version_Info{
		Version_code: StrToInt(info[0]),
		Version:      info[1],
	}
}

// 文件是否存在
func PathExists(path string) (bool, error) {

	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// 是否在数组中
func InArray[T uint | int | int8 | int64 | float32 | float64 | string](arr []T, item T) bool {
	for _, v := range arr {
		if v == item {
			return true
		}
	}
	return false
}

// 从Assets文件夹中抽取文件保存到路劲
// AssetsTakeFileToPath("config.ini", targetPath string)
func AssetsTakeFileToPath(assetsPath, targetPath string) error {
	bytes, _ := assets.Asset("assets/" + assetsPath)
	targetPathPath := path.Dir(targetPath)
	exists, err := PathExists(targetPathPath)

	if err != nil {
		return err
	}
	if !exists {
		if err := os.MkdirAll(targetPathPath, 0777); err != nil {
			return err
		}
	}
	return os.WriteFile(targetPath, bytes, 0666)
}

// 密码加密
func PasswordEncryption(password string) string {
	return Md5(Md5(Md5(password)))
}
