package main

import (
	"log"
	"panel-next/global"
	"panel-next/initialize"
	"panel-next/router"
)

func main() {
	err := initialize.InitApp()
	if err != nil {
		log.Println("初始化错误:", err.Error())
		panic(err)
	}
	httpPort := global.Config.GetValueStringOrDefault("base", "http_port")

	if err := router.InitRouters(":" + httpPort); err != nil {
		panic(err)
	}
}
