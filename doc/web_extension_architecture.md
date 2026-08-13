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
  ready(): Promise<void>
  getApiBaseUrl(): string
  getServerOrigin(): string | null
  configureServer(url: string): Promise<string>
  openUrl(url: string, mode: 'current' | 'tab'): void
}
```

`EXT-03/04` 的扩展实现会先预加载 Chrome 存储，再让现有同步存储调用读取内存镜像。服务器业务数据按 Origin 分区；Manifest 只把 HTTP/HTTPS 声明为可选主机权限，运行时申请并保留当前已验证 Origin 的权限。

## 4. 构建与运行

### Web 构建

- 保持以 `/api` 为默认同源 API。
- 保持现有 Hash Router，减少服务器回退路由和扩展页面差异。
- P1 保持现有 `dist` 输出，避免破坏后端镜像和发布脚本；在 `DUAL-02` 确定兼容迁移方案后再调整为 `dist/web`。

### 版本与产物规则

- `service/assets/version` 是 Web、后端和扩展的唯一发布版本来源；Chrome Manifest 构建时自动写入同一语义版本。
- Web 兼容产物继续输出到 `dist`；扩展目录输出到 `dist/extension`。
- 扩展发布包命名为 `panel-next-extension-v<version>.zip`，同时生成同名 `.sha256` 文件，统一放在 `artifacts`。

### 扩展构建

- 使用 Manifest V3 和 `chrome_url_overrides.newtab`。
- 扩展 `/` 路由进入独立布局外壳，Web `/` 路由保持原页面；两者暂时复用首页数据与交互组件，后续再将平台无关逻辑抽入 `panel-core`。
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

默认 CORS 配置为空，只自动允许由请求 Host、协议（含反向代理 `X-Forwarded-Proto`）确认的同源 Web 请求。额外 Web Origin 必须是无路径、查询和凭据的完整 HTTP(S) Origin；扩展必须配置精确 32 位 Chrome ID。策略拒绝通配符、`null` Origin、未声明方法和额外请求头，不开启 `Access-Control-Allow-Credentials`。

### 5.3 同步接口

第一版使用在线优先、缓存回退：

```text
GET  /api/v1/client/capabilities
POST /api/v1/sessions/login
POST /api/v1/sessions/refresh
POST /api/v1/sessions/upgrade
GET  /api/v1/sync/bootstrap
GET  /api/v1/sync/changes?since=<revision>
POST /api/v1/sync/mutations
GET  /api/v1/sessions
DELETE /api/v1/sessions/:id
```

能力发现接口无需认证。客户端可发送 `X-Panel-API-Version` 请求明确版本；未发送时选择服务端当前版本。服务端通过 `X-Panel-API-Version` 和 `X-Panel-API-Min-Version` 返回边界，非法版本返回 HTTP 400，不受支持的版本返回 HTTP 426。响应包含：

- 当前、最低、已选择和支持的 API 版本；
- 不随业务备份迁移的随机实例 ID、产品标识和应用版本；
- 支持的客户端类型，以及当前真正可用的认证方式和功能开关。

能力必须按可调用状态发布。当前 `deviceSession.available=true`，`clientTypes` 包含 `web` 与 `chrome_extension`，并公开 Extension 旧 Token 升级端点。响应同时公开旧 Token 的实际最终截止时间，客户端不能假定兼容窗口可无限延期。

`bootstrap` 一次返回新标签页首屏所需的数据和全局 `revision`。写操作携带客户端已知 revision；服务端发现过期写入时返回冲突，不静默覆盖更新的数据。

当前写入协议使用账号级 `expectedRevision`。每次分组、卡片或面板配置写操作都必须基于最近一次 bootstrap 或成功写响应返回的 revision；服务端在账号同步状态行上串行化事务，业务数据、资源 revision 与 changes 日志要么同时提交，要么同时回滚。错误码 `1502` 表示客户端版本陈旧，客户端必须重新 bootstrap，禁止用新游标重放旧表单。

`SYNC-01` 固定首版 bootstrap 数据契约：

```json
{
  "schemaVersion": 1,
  "revision": "42",
  "generatedAt": "2026-08-09T12:00:00Z",
  "account": { "id": 1, "username": "user@example.com", "name": "User" },
  "panel": {
    "revision": "40",
    "config": {},
    "searchEngine": {},
    "groups": [{ "id": 1, "title": "APP", "revision": "41", "items": [] }]
  }
}
```

- `schemaVersion` 管理缓存结构兼容性；破坏性结构变更必须增加版本并保留明确的迁移或失效策略。
- 顶层及资源 `revision` 都是非负十进制字符串，避免 JavaScript 对 64 位数据库计数器的精度损失；客户端不得转为 `number`。
- `generatedAt`、分组及卡片时间使用 RFC 3339 字符串；数组排序即服务端展示顺序。
- `account` 只包含安全摘要，响应不包含密码、Token、Token 哈希、内部 JSON 字段或冗余 `userId`。
- `GET /api/v1/sync/bootstrap` 只接受设备 Access Token，并执行 API 版本协商；能力发现中的 `syncBootstrap` 已在端点可调用后发布为 `true`。
- 聚合查询按账号隔离，以分组和卡片的服务端排序返回；账号首次使用且没有分组时，会原子创建默认分组并接管该账号的无分组卡片。

`SYNC-02` 在 `item_icon_group`、`item_icon` 和 `user_config` 增加 `BIGINT NOT NULL DEFAULT 0` 修订号，用户配置同时补充更新时间。`0` 表示迁移前或尚未纳入同步提交的资源；bootstrap DTO 将数据库整数转成十进制字符串。旧逻辑备份允许只缺少这次明确声明的迁移列，其他缺列、额外列和未知表仍拒绝恢复。

`SYNC-06` 增加账号级单调 revision 与变更日志。`GET /api/v1/sync/changes?since=<revision>&limit=<1..500>` 只接受设备 Access Token，默认每页 200 条，并返回：

```json
{
  "schemaVersion": 1,
  "fromRevision": "40",
  "nextRevision": "42",
  "currentRevision": "43",
  "hasMore": true,
  "changes": [
    {
      "revision": "41",
      "resourceType": "group",
      "resourceId": "1",
      "operation": "upsert",
      "changedAt": "2026-08-10T12:00:00Z",
      "data": { "id": 1, "title": "APP" }
    }
  ]
}
```

- `resourceType` 只允许 `panel`、`group`、`item`，`operation` 只允许 `upsert`、`delete`；删除项的 `data` 固定为 `null`。
- 客户端按 `nextRevision` 翻页，只有全部变更成功并持久化后才能推进本地游标；游标大于服务端 revision 时返回 `1501` 和 `fullBootstrapRequired=true`。
- Extension 把通过完整校验且已经应用的快照 revision 作为可信游标，不建立可独立超前的第二份游标。后台刷新优先连续拉取 changes；只有全部分页在内存中原子应用成功并完成单键持久化，才提交 v2 信封中的 `cursorRevision`。缺页、损坏 payload、游标异常或写盘失败保留旧快照并回退完整 bootstrap；v1 信封读取后自动升级。
- `user_sync_state` 与 `user_sync_change` 是派生同步状态，不进入 PostgreSQL/MySQL 可移植业务备份。逻辑恢复在同一事务清除旧日志，并按已恢复资源的最大 revision 重建账号基线；SQLite 完整快照则保留自洽的同步状态。

## 6. 客户端数据策略

平台无关的面板状态转换位于 `src/dashboard/core.ts`：bootstrap 映射、分组规范化、搜索、排序请求和网络地址选择均为无浏览器依赖的纯函数。页面组件只保留 Vue 状态编排和 RuntimeAdapter 副作用，Web 与 Extension 不维护两套业务分支。

- 服务器数据：账号、分组、卡片、面板配置、搜索引擎、组件布局和资源元数据。
- 设备本地数据：服务器地址、设备 ID、会话、最近成功快照、最后同步 revision、设备专属偏好。
- Web 使用 localStorage/IndexedDB 适配器；扩展使用 `chrome.storage.local`。
- Pinia 与工具层只使用语义明确的 `persistentStorage` 包装器，包装器再调用当前 Runtime 的 StorageAdapter；历史 `ss`/`ls` 别名已移除，现有键名和 JSON 信封保持兼容。
- 会话和缓存使用不同键空间；退出登录必须清除会话，用户可选择保留非敏感缓存。
- `chrome.storage.sync` 不保存 Sun-Panel 账号 Token，也不作为业务同步源。
- Extension 的 bootstrap 快照使用独立缓存版本，先由服务器 Origin 的 StorageAdapter 分区，再按账号 ID 分键；快照信封同时记录 Origin 与账号，读取时必须双重匹配。
- 快照写入前和读取后都校验 schemaVersion、十进制 revision、时间、字段类型、ID 唯一性、分组归属及数量/5 MiB 上限；损坏、跨实例、跨账号或未来不兼容的快照立即忽略并删除。
- Extension 在组件首次渲染前同步读取可信快照并应用面板配置、分组和卡片；随后在后台优先增量同步，无法安全应用时请求 bootstrap，成功后原子替换界面与缓存。
- 可信快照的顶层 revision 同时是当前客户端游标；增量页只有在完整应用成功后才能提交新游标，失败时保留旧快照并允许安全重试。
- 后台请求只对传输失败执行最多 3 次尝试，等待间隔为 0、1、3 秒；明确的认证或 API 响应不重试。浏览器恢复在线时可立即再次刷新，避免无限定时轮询。
- 有缓存但刷新失败时保留内容并标记“离线 · 显示缓存”；没有缓存时明确显示不可用。离线、缓存和同步中状态关闭编辑入口，第一版不伪装支持离线写入。

## 7. 新标签页性能预算

- 有缓存时应立即绘制基本布局，不因后端离线显示空白页。
- Extension 的缓存读取和应用发生在首次渲染前；网络刷新不阻塞已缓存首屏。
- 首屏不加载管理页、备份页和不需要的小组件代码。
- 小组件和设置面板动态导入。
- 壁纸使用缩略图或适配尺寸，失败时回退到内置背景。
- 天气、热搜等第三方数据由 Go 后端代理、限流和缓存，客户端不持有服务密钥。
- 在路线图进入商店发布阶段前确定并自动检查具体体积和时间预算。

## 8. 安全要求

- 扩展 CSP 禁止 `unsafe-eval` 和远程脚本。
- 所有外部 URL 在打开前验证协议，拒绝 `javascript:`、`data:` 等可执行地址。
- 模板链接和用户自定义 footer 链接在应用根节点统一拦截后交给 RuntimeAdapter；卡片 iframe 与新窗口打开共用 HTTP(S) 安全解析，Blob URL 仅保留给显式文件下载。
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
