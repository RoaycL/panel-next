# 设备会话安全设计

## 范围

`user_session` 为 Web 与 Chrome Extension 提供可撤销的设备级会话。`SESSION-01` 建立数据模型和迁移，`SESSION-02` 提供 Token 签发、校验、轮换与重用检测服务；`SESSION-06`、`SESSION-07` 已分别接入 Web 与 Extension。

## 数据约束

- 每个会话使用随机 UUID 标识，按 `user_id + device_id + client_type` 唯一。
- `client_type` 仅允许 `web` 或 `chrome_extension`。
- Access Token 和 Refresh Token 明文只在签发响应中出现一次；数据库只保存 SHA-256 哈希。
- Access、Refresh 过期时间分别保存；撤销使用 `revoked_at`，不物理删除审计记录。
- `last_active_at` 用于设备列表和闲置会话策略，不延长 Refresh Token 的绝对期限。
- 修改密码、检测到 Refresh Token 重用或账号停用时必须撤销相关会话。

## Token 生命周期

- Access Token 与 Refresh Token 分别使用 32 字节密码学安全随机数，并以无填充 Base64 URL 编码返回。
- 明文 Token 只返回给调用方，数据库只保存 SHA-256 哈希；日志不得输出明文或哈希。
- Access Token 默认有效期 15 分钟，Refresh Token 绝对有效期 30 天。轮换不会延长 Refresh 的绝对期限，Access 也不会越过该期限。
- 每次刷新都同时替换 Access/Refresh Token，并把已消费的 Refresh 哈希写入 `user_session_refresh_token`。
- 已消费 Refresh Token 再次出现时，视为凭据可能泄露，事务内撤销其整个设备会话；当前已签发的 Access Token 随即失效。
- 轮换使用数据库事务、会话行锁和旧哈希条件更新，避免同一 Refresh Token 并发产生两个有效后继。
- 同一账号、设备 ID 与客户端重新登录时复用设备记录并轮换凭据；被替换的 Refresh 哈希继续参与重放检测。

## 登录与刷新接口

- `POST /api/v1/sessions/login`：接受 `clientType=web` 或 `chrome_extension`，校验账号后签发设备会话和安全用户摘要。
- `POST /api/v1/sessions/refresh`：消费一次 Refresh Token，同时轮换 Access/Refresh；失败不返回凭据细节。
- `POST /api/v1/sessions/upgrade`：只允许已通过旧 Token 认证的 Extension 调用；升级成功后签发设备会话并删除服务端旧 Token 映射，使已提交的旧凭据立即失效。
- 受保护接口优先校验 `Authorization: Bearer <Access Token>`；历史上传组件的 `token` 头也会先按新 Access 校验。
- Access 过期返回代码 `1008`，Web 只执行一次自动刷新并重放原请求；Refresh 无效、过期、重放或会话撤销返回 `1001` 并要求重新登录。
- Web 多标签页使用 Web Locks 串行化刷新；后进入的标签读取共享存储中的新 Token，不重复提交已消费 Refresh。
- Extension 使用 Web Locks 串行化同一浏览器配置中的刷新，并在锁内先写回、再同步 `chrome.storage.local`，避免多个新标签页重复消费 Refresh Token。

## 旧 Token 兼容窗口

- 历史 `/api/login` 与旧 `token` 认证仅在 `[session] legacy_token_until` 之前可用。
- 编译内置最终截止为 `2026-11-07T00:00:00Z`；配置可以提前关闭，但不能延后该日期，无效配置按已关闭处理。
- 已保存旧 Token 的 Extension 会在启动时尝试升级；成功后仅保留按服务器 Origin 隔离的新设备会话。网络瞬断时保留旧 Token 以便重试，服务端明确返回无效或兼容期结束时才清除并要求重新登录。
- Extension 的设备 ID 和会话都按服务器 Origin 隔离，切换自托管实例时不得向新实例发送旧实例凭据。
- 截止后旧登录或旧认证返回 `1009`。设备 Access Token 不受旧兼容开关影响。

## 备份边界

设备会话属于可重新签发的安全状态，不进入 Panel Next 逻辑业务备份。恢复业务数据后，所有设备必须重新认证，避免把旧实例的有效凭据复制到新实例。

## 设备管理接口

- `POST /api/user/session/getList`：返回当前账号未撤销的设备，按最后活跃时间倒序；响应只含设备、客户端、时间和当前设备标记。
- `POST /api/user/session/revoke`：按 `sessionId` 撤销当前账号的一台设备。账号条件始终参与更新，其他账号的会话统一表现为不存在。
- `POST /api/user/session/revokeAll`：撤销当前账号全部未撤销设备，并返回实际撤销数量。
- 修改密码时，密码更新、旧账号 Token 清空和全部设备撤销在同一数据库事务内完成。
- 退出登录在新会话中间件提供当前 `sessionId` 后同步撤销当前设备；旧 Token 兼容期仍清除原有缓存凭据。

## 后续验证

自动测试已覆盖登录、刷新、撤销、重放、过期、关闭并重开数据库连接、并发刷新和多账号隔离；会话相关包使用 Go 竞态检测回归。仍需在具备桌面 Chrome 的环境中完成人工加载验收。
