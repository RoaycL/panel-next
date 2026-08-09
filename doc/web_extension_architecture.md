# Web 与 Chrome 扩展双端架构

## 1. 目标

Sun-Panel 同时提供两种客户端，并共用同一个 Go 后端和账号数据：

- Web：保持现有网页部署、公开访问和管理体验。
- Chrome 扩展：使用 Manifest V3 覆盖新标签页，提供类似 iTab 的快速启动桌面。
- 同一账号的分组、卡片、壁纸、搜索引擎、主题和组件配置由后端同步。
- 扩展在网络暂时不可用时优先展示最近一次可信缓存，恢复联网后刷新。

这不是重写项目。现有 Vue 组件、Pinia 状态和 Go 业务模型继续使用；改造重点是客户端运行环境抽象、设备会话、同步协议和扩展构建外壳。

## 2. 边界与非目标

- Chrome 扩展只使用打包在扩展内的脚本，不加载或执行远程代码。
- 扩展默认只申请 `storage`；服务器访问权限按用户配置的源站按需申请，避免默认使用 `<all_urls>`。
- 后端是跨设备数据的唯一权威来源；`chrome.storage.local` 只保存服务器地址、设备会话和可丢弃缓存。
- 密钥、第三方 API Token 和用户密码不得进入客户端同步数据。
- 第一版不实现多端离线同时编辑、浏览器书签接管、内容脚本注入或 Chrome Sync 数据同步。
- Web 保持现有部署方式；双端改造不得要求现有用户必须安装扩展。
- 继续遵守 MIT 开源基线独立开发边界，不复制闭源实现或资源。

## 3. 目标结构

在原型阶段先在当前目录内增加边界，验证后再机械迁移为 pnpm workspace：

```text
apps/
  web/                    Web 入口、HTML 与 Vite 配置
  extension/              manifest、newtab、service worker、扩展图标
packages/
  panel-core/             面板领域状态、用例和同步模型
  panel-ui/               首页、分组、卡片、搜索和组件 UI
  api-client/             与运行环境无关的类型化 API 客户端
  runtime/                Web/Chrome 能力适配器
  storage/                localStorage/chrome.storage 适配器
service/                  Go 后端
```

迁移完成前允许保留现有 `src`，但新增代码必须通过下列边界访问平台能力：

```ts
interface RuntimeAdapter {
  readonly kind: 'web' | 'extension'
  storage: StorageAdapter
  getApiBaseUrl(): Promise<string>
  requestHostPermission(origin: string): Promise<boolean>
  openUrl(url: string, mode: 'current' | 'tab' | 'embedded'): Promise<void>
}
```

## 4. 构建与运行

### Web 构建

- 保持以 `/api` 为默认同源 API。
- 保持现有 Hash Router，减少服务器回退路由和扩展页面差异。
- 输出到 `dist/web`，后端镜像仍只托管 Web 产物。

### 扩展构建

- 使用 Manifest V3 和 `chrome_url_overrides.newtab`。
- 输出到 `dist/extension`，包含 `manifest.json`、`newtab.html`、静态资源和可选 service worker。
- Vite 资源基路径使用相对地址，不依赖站点根目录。
- 扩展新标签页首屏不得等待全部远程接口；先读取本地快照，再后台刷新。
- Web 与扩展使用同一套版本号来源，但分别生成发布包。

## 5. 后端演进

### 5.1 设备会话

当前临时会话缓存不适合作为扩展长期同步凭据。新增持久化设备会话，至少包含：

```text
user_session
  id
  user_id
  device_id
  device_name
  client_type          web | chrome_extension
  access_token_hash
  refresh_token_hash
  access_expires_at
  refresh_expires_at
  last_active_at
  revoked_at
  created_at
```

要求：

- Token 只以不可逆哈希保存，响应和日志不得输出明文。
- 每台设备可独立撤销；修改密码时可撤销全部会话。
- Access Token 短期有效，Refresh Token 可轮换并检测重复使用。
- 保留旧登录接口的迁移窗口，Web 与扩展切换完成后再移除旧会话逻辑。

### 5.2 跨源与服务器发现

- Web 默认同源，不扩大 CORS。
- 扩展服务器地址由用户输入并验证，只接受 `http`/`https`；生产环境提示使用 HTTPS。
- CORS 仅允许配置过的 Web Origin 和扩展 ID，并允许认证头、语言头及预检请求。
- 新增无认证的服务器信息接口，返回 API 版本、实例标识和认证能力，禁止泄漏部署详情。

### 5.3 同步接口

第一版使用在线优先、缓存回退：

```text
GET  /api/v1/client/capabilities
GET  /api/v1/sync/bootstrap
GET  /api/v1/sync/changes?since=<revision>
POST /api/v1/sync/mutations
GET  /api/v1/sessions
POST /api/v1/sessions/refresh
DELETE /api/v1/sessions/:id
```

`bootstrap` 一次返回新标签页首屏所需的数据和全局 `revision`。写操作携带客户端已知 revision；服务端发现过期写入时返回冲突，不静默覆盖更新的数据。

## 6. 客户端数据策略

- 服务器数据：账号、分组、卡片、面板配置、搜索引擎、组件布局和资源元数据。
- 设备本地数据：服务器地址、设备 ID、会话、最近成功快照、最后同步 revision、设备专属偏好。
- Web 使用 localStorage/IndexedDB 适配器；扩展使用 `chrome.storage.local`。
- 会话和缓存使用不同键空间；退出登录必须清除会话，用户可选择保留非敏感缓存。
- `chrome.storage.sync` 不保存 Sun-Panel 账号 Token，也不作为业务同步源。

## 7. 新标签页性能预算

- 有缓存时应立即绘制基本布局，不因后端离线显示空白页。
- 首屏不加载管理页、备份页和不需要的小组件代码。
- 小组件和设置面板动态导入。
- 壁纸使用缩略图或适配尺寸，失败时回退到内置背景。
- 天气、热搜等第三方数据由 Go 后端代理、限流和缓存，客户端不持有服务密钥。
- 在路线图进入商店发布阶段前确定并自动检查具体体积和时间预算。

## 8. 安全要求

- 扩展 CSP 禁止 `unsafe-eval` 和远程脚本。
- 所有外部 URL 在打开前验证协议，拒绝 `javascript:`、`data:` 等可执行地址。
- iframe 只是兼容能力；目标站点的 CSP 或 `X-Frame-Options` 禁止嵌入时回退到新标签页。
- 扩展权限遵循最小权限原则，每项新增权限都在发布清单中说明用户价值。
- 登录、刷新、撤销、同步冲突和权限变更写入不含敏感明文的安全日志。
- Chrome 商店发布前完成隐私政策、数据披露、依赖审计和打包内容检查。

## 9. 关键架构决策

| 编号 | 决策 | 原因 |
| --- | --- | --- |
| ADR-001 | 一个后端、两个客户端外壳 | 最大化复用并保持 Web 兼容 |
| ADR-002 | 后端作为同步权威源 | 避免 Chrome Sync 配额、平台绑定和敏感数据风险 |
| ADR-003 | 使用 Runtime/Storage 适配器 | 隔离 `window`、`localStorage` 与 `chrome.*` 差异 |
| ADR-004 | 扩展按需申请服务器 Origin | 减少权限警告和商店审核风险 |
| ADR-005 | 先缓存回退，再实现离线写入 | 优先交付可靠的新标签页体验，控制冲突复杂度 |
| ADR-006 | 新设备会话替换进程内临时会话 | 支持多设备、撤销、过期和服务重启 |

变更上述决策时，应在本文件追加新 ADR，说明兼容和迁移影响，不直接覆盖历史原因。

## 10. 完成定义

双端基础架构完成需要同时满足：

- 同一账号在 Web 和已加载的 Chrome 扩展中看到一致的分组、卡片和面板配置。
- 任一端完成编辑后，另一端刷新或增量同步可以得到变化。
- 后端不可用时，扩展能展示最近一次成功缓存并明确标记离线状态。
- Web 原有登录、公开访问、编辑和管理功能回归通过。
- 扩展不包含远程代码，不申请未使用权限，不在包内包含服务器凭据。
- `pnpm` 类型检查、Web 构建、扩展构建、Go 测试及安全测试全部通过。
