package cmn

import (
	"fmt"
	"os"
	"path"
	"time"

	"github.com/fatih/color"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	LOG_DEBUG   = "Debug"
	LOG_ERROR   = "Error"
	LOG_Info    = "Info"
	LOG_WARNING = "Warning"
)

var colors = map[string]func(a ...interface{}) string{
	"Warning": color.New(color.FgYellow).Add(color.Bold).SprintFunc(),
	"Panic":   color.New(color.BgRed).Add(color.Bold).SprintFunc(),
	"Error":   color.New(color.FgRed).Add(color.Bold).SprintFunc(),
	"Info":    color.New(color.FgCyan).Add(color.Bold).SprintFunc(),
	"Debug":   color.New(color.FgWhite).Add(color.Bold).SprintFunc(),
}

var spaces = map[string]string{
	"Warning": "",
	"Panic":   "  ",
	"Error":   "  ",
	"Info":    "   ",
	"Debug":   "  ",
}

func Pln(prefix string, msg string) {
	fmt.Printf(
		"%s%s %s %s\n",
		colors[prefix]("["+prefix+"]"),
		spaces[prefix],
		time.Now().Format(TimeFormatMode1),
		msg,
	)
}

func Print(colorKey, key, msg string) {
	fmt.Printf(
		"%s%s %s\n",
		colors[colorKey](key),
		time.Now().Format(TimeFormatMode1),
		msg,
	)
}

func InitLogger(fileName string, level zapcore.LevelEnabler) *zap.SugaredLogger {
	logDir := path.Dir(fileName)
	if ok, _ := PathExists(logDir); !ok {
		os.MkdirAll(logDir, 0700)
	}
	syncWriter := getLogWriter(fileName)
	encoder := getEncoder()
	core := zapcore.NewCore(encoder, syncWriter, level)
	logger := zap.New(core, zap.AddCaller())
	return logger.Sugar()
}

func getEncoder() zapcore.Encoder {
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	encoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	return zapcore.NewConsoleEncoder(encoderConfig)
}

func getLogWriter(fileName string) zapcore.WriteSyncer {
	file, err := os.OpenFile(fileName, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0666)
	if err != nil {
		panic(err)
	}
	return zapcore.AddSync(file)
}