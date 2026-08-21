# Panel Next 升级、回滚与兼容矩阵

> 最后更新：2026-08-21

## 1. 版本体系

- 单一版本源：`service/assets/version`（格式 `version_code|semantic_version`，如 `10|1.3.0`）
- 前端 Web、Chrome 扩展、后端共用该语义版本；扩展 manifest 版本由构建同步
- API 版本通过 `X-Panel-API-Version` 协商，当前 `current=1`、`minimum=1`

## 2. 升级

### 2.1 Docker 部署

```bash
# 拉取最新代码或镜像
git pull
docker compose build
docker compose up -d
```

服务启动时自动执行数据库迁移（`AutoMigrate`）：
- 新增表自动创建（如 `public_file`、`notice`、`user_session` 等）
- 新列自动补充（如 `file.type`、`item_icon.revision` 等）
- 不会删除既有列或表，保证向前兼容

### 2.2 扩展

- 商店版：商店自动更新
- 开发者模式：`chrome://extensions` → 刷新；扩展 ID 固定（manifest `key`），数据与会话保留

### 2.3 升级前建议

1. 管理员在「备份与恢复」下载完整备份
2. 阅读更新日志 / Git 提交记录，确认无破坏性变更
3. 升级后验证登录、分组、卡片、同步刷新

## 3. 回滚

### 3.1 Docker 回滚

```bash
# 切回上一提交/镜像
git checkout <上一版本>
docker compose build
docker compose up -d
```

**注意**：若新版本执行了数据库迁移（新增表/列），旧版本可能无法读取新增字段；GORM 在旧代码下通常能忽略未知列，但强烈建议：

- 回滚前用完整备份恢复数据库
- 或在新版本导出备份、回滚后恢复

### 3.2 扩展回滚

- 商店版：Chrome Web Store 开发者控制台保留历史版本，可一键回滚
- 开发者模式：加载旧构建包即可（固定 ID 不变，会话保留）

## 4. API 兼容矩阵

| API 版本 | 前端支持 | 后端支持 | 兼容方式 |
| --- | --- | --- | --- |
| v1 | Web（带 `X-Panel-API-Version: 1`）、Chrome 扩展 | current=1, minimum=1 | 头协商，不匹配返回 400/426 |

**协商规则**：
- 客户端请求头 `X-Panel-API-Version` 指定版本；未指定则选择服务端当前版本
- 服务端通过响应头 `X-Panel-API-Version`、`X-Panel-API-Min-Version` 告知边界
- 非法版本 → HTTP 400；高于支持的版本 → HTTP 426

**能力开关**：`GET /api/v1/client/capabilities` 按可调用状态发布能力（如 `deviceSession.available`、`syncBootstrap`），前端据此降级。

## 5. 最低后端版本提示

- **Web**：请求 `capabilities` 失败或返回 `426` 时，说明后端版本过旧，无法使用同步/设备会话。登录页/首页应提示"服务器版本过旧，请升级 Panel Next 服务端"。
- **Chrome 扩展**：连接服务器时先请求 `loginConfig`/`capabilities` 校验兼容性；不兼容时给出明确错误（"目标地址不是兼容的 Panel Next / Sun-Panel 服务"）。

**建议实现**：前端在收到 `426` 或 `X-Panel-API-Min-Version` 大于客户端期望时，展示升级提示而非静默失败。

## 6. 兼容性约束

| 组件 | 向后兼容要求 |
| --- | --- |
| 同步协议 | revision 为十进制字符串，客户端不得转 number；`expectedRevision` 冲突返回 1502 |
| 备份恢复 | 恢复接受 `panel-next` 与 `sun-panel` 两种 manifest（向后兼容旧备份） |
| 旧 Token | legacy token 最晚 `2026-11-07T00:00:00Z` 关闭，可配置提前；客户端可通过 `capabilities` 获取实际截止时间 |
| 扩展 Origin | 服务端自动放行格式合法的 `chrome-extension://` Origin，升级后端即可兼容任意扩展 ID |

## 7. 升级建议节奏

- 生产环境先备份，再升级
- 从 `main` 拉取最新或指定 tag 构建
- 重大结构变更（如同步协议、数据库）需在更新日志中注明
