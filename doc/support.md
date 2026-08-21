# Panel Next 部署与支持文档

> 最后更新：2026-08-21

## 1. 数据用途说明

Panel Next 是自托管服务，数据存储于您自己的服务器。完整隐私政策见 [privacy.md](./privacy.md)。

**核心原则**：
- 服务端只保存账号、面板配置、上传文件与同步状态，全部在您的服务器上
- 浏览器 / Chrome 扩展只在本机保存服务器地址、会话与缓存
- 不向任何第三方上报数据

## 2. 部署方式

### 2.1 Docker Compose（推荐）

```yaml
# docker-compose.yml
services:
  panel-next:
    build: .
    container_name: panel-next
    network_mode: host
    volumes:
    - ./docker-conf:/app/conf
    - ./service/uploads:/app/uploads
    - ./service/database:/app/database
    restart: always
```

```bash
docker compose build
docker compose up -d
```

> 说明：`network_mode: host` 让容器共享宿主机网络栈，便于连接宿主机上的 PostgreSQL（监听 127.0.0.1）。端口与数据库配置见 `docker-conf/conf.ini`。

### 2.2 原生二进制

```bash
cd service && go build -o panel-next .
./panel-next
```

### 2.3 配置

配置文件为 `conf/conf.ini`（首次启动自动从内嵌示例生成）：

| 配置段 | 关键项 | 说明 |
| --- | --- | --- |
| `[base]` | `http_port` | HTTP 监听端口 |
| `[base]` | `database_drive` | `postgres`（默认）/ `sqlite` / `mysql` |
| `[base]` | `source_path` | 上传文件存储目录 |
| `[base]` | `web_path` | Web 静态资源目录（默认 `./web`） |
| `[cors]` | `web_origins` | 额外允许的 Web 跨源 Origin（默认同源） |
| `[session]` | `legacy_token_until` | 旧 Token 兼容截止时间 |
| `[sqlite]` | `file_path` | SQLite 数据库文件路径 |

## 3. Chrome 扩展安装

1. 构建或解压扩展包（`dist/extension` 或 `artifacts/panel-next-extension-v<version>.zip`）
2. 打开 `chrome://extensions/`
3. 右上角开启**开发者模式**
4. 点击**加载已解压的扩展程序**，选择 `dist/extension` 目录
5. 新标签页打开后输入服务器地址并登录

**关于扩展 ID**：
- 扩展 ID 由 manifest 中的 `key`（公钥）派生，本项目已固定密钥，因此重装扩展 ID 不变
- 服务端会自动放行任何格式合法的 `chrome-extension://<32位ID>` Origin，无需逐个配置
- 私钥存放在 `.secrets/extension-key.pem`，请务必保管好且不要提交到公开仓库

## 4. 默认管理员账号

首次初始化自动创建管理员：

- 账号：`admin@sun.cc`（在 PostgreSQL 等已存在用户时不会重复创建）
- 密码：`12345678`（请立即修改）

登录后到「账号管理」可创建用户、重置密码、设置公开访问账号。

## 5. 常见问题

### 5.1 页面一直加载 / 登录没反应
- 硬刷新浏览器（Ctrl+Shift+R）清除旧 JS 缓存
- 确认使用正确的管理员账号密码
- 检查浏览器控制台是否有 CORS 报错；扩展场景下确认服务端版本已支持自动放行扩展 Origin

### 5.2 扩展登录失败
- 确认扩展为最新构建（含固定 `key`）
- 确认服务器地址 `https://...` 可访问
- 服务端 CORS 会自动放行格式合法的扩展 Origin；若仍失败，检查 `conf/conf.ini` 的 `[cors] web_origins`

### 5.3 备份与恢复
见 [backup_restore_fork.md](./backup_restore_fork.md)。管理员在「备份与恢复」应用可下载完整备份，并排队恢复。

### 5.4 修改密码后其他设备
修改密码会在同一事务撤销该账号的所有设备会话，其他设备需重新登录。

### 5.5 为什么看不到默认分组
首次使用 bootstrap 时会自动创建默认分组（APP）并接管无分组卡片。若之前已有数据则不会重复创建。

## 6. 账号删除

管理员在「账号管理」删除账号时，会同时移除该账号的会话、同步状态、面板配置、分组与卡片等关联数据。详情见 [privacy.md](./privacy.md#6-账号删除)。

## 7. 联系方式

- 项目仓库：<https://github.com/RoaycL/panel-next>
- Issues：<https://github.com/RoaycL/panel-next/issues>
- Discussions：<https://github.com/RoaycL/panel-next/discussions>
