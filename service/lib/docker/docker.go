package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultSocket   = "/var/run/docker.sock"
	defaultHost     = "unix://" + defaultSocket
	defaultTimeout  = 10 * time.Second
	maxResponseSize = 1 << 20
)

var (
	ErrSocketNotFound = errors.New("docker socket not found")
	ErrUnreachable    = errors.New("docker daemon unreachable")
)

// Container 容器信息
type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  []Port `json:"ports,omitempty"`
}

type Port struct {
	PrivatePort int    `json:"privatePort"`
	PublicPort  int    `json:"publicPort,omitempty"`
	Type        string `json:"type"`
	IP          string `json:"ip,omitempty"`
}

type apiContainer struct {
	ID     string `json:"Id"`
	Names  []string
	Image  string
	State  string
	Status string
	Ports  []struct {
		PrivatePort int
		PublicPort  int
		Type        string
		IP          string
	}
}

// Client Docker Engine API 客户端
type Client struct {
	httpClient *http.Client
	socketPath string
	baseURL    string
}

func NewClient(socketPath string) *Client {
	if socketPath == "" {
		socketPath = defaultSocket
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &Client{
		httpClient: &http.Client{Timeout: defaultTimeout, Transport: transport},
		socketPath: socketPath,
		baseURL:    "http://localhost",
	}
}

// DefaultClient 自动检测 Docker socket
func DefaultClient() *Client {
	paths := []string{defaultSocket, "/run/docker.sock", "/docker.sock"}
	for _, p := range paths {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return NewClient(p)
		}
	}
	return NewClient(defaultSocket)
}

// IsAvailable 检测 Docker socket 是否可用
func (c *Client) IsAvailable() bool {
	if info, err := os.Stat(c.socketPath); err != nil || info.IsDir() {
		return false
	}
	if _, err := c.GetVersion(); err != nil {
		return false
	}
	return true
}

// GetVersion 获取 Docker 版本信息
func (c *Client) GetVersion() (map[string]interface{}, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/version")
	if err != nil {
		return nil, ErrUnreachable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("docker version returned %d", resp.StatusCode)
	}
	var result map[string]interface{}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseSize)).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

// ListContainers 列出所有容器（含停止的）
func (c *Client) ListContainers(ctx context.Context) ([]Container, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/containers/json?all=true", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, ErrUnreachable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("docker list returned %d: %s", resp.StatusCode, string(body))
	}

	var apiContainers []apiContainer
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseSize)).Decode(&apiContainers); err != nil {
		return nil, err
	}

	containers := make([]Container, 0, len(apiContainers))
	for _, ac := range apiContainers {
		name := ""
		if len(ac.Names) > 0 {
			name = strings.TrimPrefix(ac.Names[0], "/")
		}
		ports := make([]Port, 0, len(ac.Ports))
		for _, p := range ac.Ports {
			ports = append(ports, Port{
				PrivatePort: p.PrivatePort,
				PublicPort:  p.PublicPort,
				Type:        p.Type,
				IP:          p.IP,
			})
		}
		containers = append(containers, Container{
			ID:     ac.ID,
			Name:   name,
			Image:  ac.Image,
			Status: ac.Status,
			State:  ac.State,
			Ports:  ports,
		})
	}
	return containers, nil
}

// containerAction 执行容器操作（start/stop/restart）
func (c *Client) containerAction(ctx context.Context, containerID, action string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/containers/"+containerID+"/"+action, nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ErrUnreachable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 && resp.StatusCode != 304 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("docker %s returned %d: %s", action, resp.StatusCode, string(body))
	}
	return nil
}

func (c *Client) StartContainer(ctx context.Context, containerID string) error {
	return c.containerAction(ctx, containerID, "start")
}

func (c *Client) StopContainer(ctx context.Context, containerID string) error {
	return c.containerAction(ctx, containerID, "stop")
}

func (c *Client) RestartContainer(ctx context.Context, containerID string) error {
	return c.containerAction(ctx, containerID, "restart")
}
