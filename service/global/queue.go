package global

import (
	"sun-panel/lib/queue"
	"sun-panel/lib/queue/queueMemory"
	"sun-panel/lib/queue/queueRedis"
	"sun-panel/structs"
)

// 创建一个队列
// name:缓存名称
func NewQueuer(name string) queue.Queuer {
	drive := Config.GetValueString("base", "queue_drive")
	if drive == "" {
		drive = "memory"
	}
	var queuer queue.Queuer
	Logger.Debugln("队列驱动:", drive)
	switch drive {
	case "memory":
		queuer = queueMemory.New()
	case "redis":
		redisConfig := structs.IniConfigRedis{}
		if err := Config.GetSection("redis", &redisConfig); err != nil {
			redisConfig.Prefix = ""
		}
		queuer = queueRedis.New(RedisDb, redisConfig.Prefix+name)
	}

	return queuer
}
