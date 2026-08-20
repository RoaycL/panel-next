package system

import (
	"context"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/lib/docker"
	"time"

	"github.com/gin-gonic/gin"
)

type DockerApi struct {
	client *docker.Client
}

func (a *DockerApi) getClient() *docker.Client {
	if a.client == nil {
		a.client = docker.DefaultClient()
	}
	return a.client
}

// GetStatus 检测 Docker 是否可用（所有登录用户）
func (a *DockerApi) GetStatus(c *gin.Context) {
	client := a.getClient()
	if !client.IsAvailable() {
		apiReturn.SuccessData(c, gin.H{"available": false})
		return
	}
	version, err := client.GetVersion()
	if err != nil {
		apiReturn.SuccessData(c, gin.H{"available": false})
		return
	}
	apiReturn.SuccessData(c, gin.H{
		"available": true,
		"version":   version,
	})
}

// GetList 列出容器（所有登录用户可读）
func (a *DockerApi) GetList(c *gin.Context) {
	client := a.getClient()
	if !client.IsAvailable() {
		apiReturn.Error(c, "docker daemon unreachable")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultDockerTimeout())
	defer cancel()

	containers, err := client.ListContainers(ctx)
	if err != nil {
		apiReturn.Error(c, err.Error())
		return
	}

	// 按名称排序
	sortContainersByName(containers)

	apiReturn.SuccessListData(c, containers, int64(len(containers)))
}

// StartContainer 管理员启动容器
func (a *DockerApi) StartContainer(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	if userInfo.Role != 1 {
		apiReturn.ErrorNoAccess(c)
		return
	}

	containerID := c.Query("id")
	if containerID == "" {
		apiReturn.ErrorParamFomat(c, "id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultDockerTimeout())
	defer cancel()

	if err := a.getClient().StartContainer(ctx, containerID); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	apiReturn.Success(c)
}

// StopContainer 管理员停止容器
func (a *DockerApi) StopContainer(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	if userInfo.Role != 1 {
		apiReturn.ErrorNoAccess(c)
		return
	}

	containerID := c.Query("id")
	if containerID == "" {
		apiReturn.ErrorParamFomat(c, "id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultDockerTimeout())
	defer cancel()

	if err := a.getClient().StopContainer(ctx, containerID); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	apiReturn.Success(c)
}

// RestartContainer 管理员重启容器
func (a *DockerApi) RestartContainer(c *gin.Context) {
	userInfo, _ := base.GetCurrentUserInfo(c)
	if userInfo.Role != 1 {
		apiReturn.ErrorNoAccess(c)
		return
	}

	containerID := c.Query("id")
	if containerID == "" {
		apiReturn.ErrorParamFomat(c, "id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultDockerTimeout())
	defer cancel()

	if err := a.getClient().RestartContainer(ctx, containerID); err != nil {
		apiReturn.Error(c, err.Error())
		return
	}
	apiReturn.Success(c)
}

func defaultDockerTimeout() time.Duration {
	return 30 * time.Second
}

func sortContainersByName(containers []docker.Container) {
	for i := 1; i < len(containers); i++ {
		for j := i; j > 0 && containers[j].Name < containers[j-1].Name; j-- {
			containers[j], containers[j-1] = containers[j-1], containers[j]
		}
	}
}
