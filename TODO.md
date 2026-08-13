# Panel Next 主待办清单

本文是跨设备继续开发的唯一执行入口。功能对齐的详细证据见 `OPEN_FEATURE_PARITY.md`，双端设计见 `doc/web_extension_architecture.md`。

## 当前状态

- 状态更新时间：`2026-08-13`。
- 当前开发分支：`agent/postgres-device-sync-foundation`（基于已合并扩展基础的 `main`）。
- 已完成：前端工具链升级、SQLite 完整备份恢复、MySQL/PostgreSQL 逻辑备份迁移。
- 当前主线：先建立 Web/Chrome 双端基础，再继续品牌、图库、组件和官方公开能力对齐。
- 双端布局：Web 保持原导航布局；Extension 已建立专用新标签页路由与响应式玻璃分组布局，底层数据和卡片交互继续共享。
- 最近验证：后端 `go test ./...`、`go vet ./...` 及同步状态/面板写接口 `-race` 通过；前端架构/缓存校验、TypeScript 类型检查、本次改动文件 ESLint、Web/Extension 生产构建和扩展包校验通过（全仓仍有 47 个历史 ESLint 错误）；本机 PostgreSQL 17.10 已验证同步表迁移、约束与索引。
- 已知环境缺口：PostgreSQL 17.10 已完成真实迁移及备份恢复演练；MySQL 真实恢复演练和 Chrome 手工加载仍待具备相应环境时执行。

## P0：架构与仓库准备

- [x] `DUAL-00` 记录 Web/Chrome 双端目标、边界、ADR、安全要求和完成定义。
- [x] `DUAL-01` 建立跨设备主待办清单和接手步骤。
- [x] `DUAL-02` 为 Web 和 Extension 确定共享版本号、产物目录及发布命名规则。实现：`service/assets/version` 为唯一发布版本源；Web 保持 `dist`，扩展为 `dist/extension`；发布包为 `artifacts/panel-next-extension-v<version>.zip` 及 SHA-256。
- [x] `DUAL-03` 增加架构约束测试，禁止共享核心直接依赖 `chrome.*` 或未经封装的存储 API。实现：`pnpm validate:architecture` 扫描共享源码，仅允许 Web/Extension 适配器访问平台 API，并纳入 `build:all`。

## P1：最小扩展原型

- [x] `EXT-01` 新建 Manifest V3 扩展入口，以 `newtab.html` 覆盖新标签页。实现：`extension/manifest.json`、`extension/newtab.html`、Vite `extension` 模式；产物为 `dist/extension`。
- [x] `EXT-02` 增加 `RuntimeAdapter`、`StorageAdapter` 和 Web 实现，不改变现有行为。实现：`src/runtime`；本地状态和 URL 打开行为已通过适配器访问，应用启动会等待运行环境就绪。
- [x] `EXT-03` 增加 Chrome 实现，启动时将 `chrome.storage.local` 预加载到同步内存镜像；业务数据按服务器 Origin 隔离，配置和会话不跨实例混用。
- [x] `EXT-04` 支持配置、验证并切换 Panel Next / Sun-Panel 服务器地址；仅在用户操作时申请目标 Origin 权限，通过公开登录配置接口验证兼容性，切换后撤销旧 Origin 权限。
- [x] `EXT-05` 使用当前账号接口完成扩展登录验证，仅作为原型，明确标记待迁移认证。实现：扩展无按 Origin 隔离的原型 Token 时强制进入登录页；登录仍调用当前 `/api/login`，失效 Token 由现有认证响应清除并返回登录页。后续必须由 `SESSION-*` 替换。
- [x] `EXT-06` 从现有 API 加载分组、卡片和面板配置，渲染共享首页。实现：账号验证成功后并行加载分组/卡片与面板配置，卡片请求按分组并发，异常响应不再解引用空数据。
- [x] `EXT-07` 增加 `pnpm build:web`、`pnpm build:extension` 和扩展 ZIP 打包命令。`pnpm package:extension` 会先构建和安全校验，再生成不含顶层目录的 ZIP 与 SHA-256。
- [ ] `EXT-08` 在 Chrome 开发者模式手工验收：安装、覆盖新标签页、登录、打开卡片、重启浏览器后恢复。

P1 验收门槛：不得修改生产数据库结构；不得发布到 Chrome 商店；Web 功能必须保持兼容。

## 数据库迁移状态

- [x] `DB-PG-01` PostgreSQL 驱动、连接池、自动建表和配置接入；新生成配置及 Docker Compose 默认使用 PostgreSQL 17。
- [x] `DB-PG-02` PostgreSQL 使用版本化逻辑备份/恢复，恢复在事务内执行并在导入显式 ID 后校准序列。
- [x] `DB-PG-03` 移除模型中的 MySQL 专属 `tinyint(1)` / `int(11)` 类型声明，保持 SQLite、MySQL 与 PostgreSQL 可迁移。
- [x] `DB-PG-04` 在真实 PostgreSQL 服务完成演练：本机 PostgreSQL 17.10 已完成独立角色/数据库创建、TCP/SCRAM 连接、自动建表、默认数据初始化、应用重启及完整逻辑备份恢复；恢复验证覆盖数据回退、序列校准、待恢复包消费和 API 可用性。

## P2：安全设备会话与跨源访问

- [x] `SESSION-01` 设计并迁移 `user_session` 数据表。实现：`service/models/userSession.go`、自动迁移与唯一设备约束；Token 字段只允许 64 位哈希，支持过期、最后活跃和软撤销。安全边界见 `doc/device_session_security.md`，设备会话不进入可移植业务备份。
- [x] `SESSION-02` 实现哈希化 Access/Refresh Token、过期、轮换和重复使用检测。实现：`service/lib/session` 使用 256 位高熵随机 Token，数据库仅存 SHA-256；Access 15 分钟、Refresh 30 天绝对期限；Refresh 在事务内单次轮换，消费历史重放会自动撤销设备会话。单元测试、竞态检测和本机 PostgreSQL 真实迁移均通过。
- [x] `SESSION-03` 实现多设备列表、单设备撤销和全部撤销。新增严格登录保护的 `/api/user/session/getList`、`revoke`、`revokeAll`；响应不含凭据哈希，查询和撤销均绑定当前用户，支持当前设备标记和幂等撤销。修改密码会在同一事务撤销所有设备。服务层及 HTTP 处理器的用户隔离、响应脱敏和竞态测试通过。
- [x] `SESSION-04` 新增客户端能力发现接口和 API 版本协商。`GET /api/v1/client/capabilities` 无需认证，支持 `X-Panel-API-Version` 协商及 400/426 边界响应；仅发布当前可调用能力。随机实例 ID 存在独立本机元数据表，不随业务备份迁移。单元测试、真实 PostgreSQL 迁移和 HTTP 200/426 演练通过。
- [x] `SESSION-05` 配置精确 CORS Origin、扩展 ID 白名单和预检请求。新增 `[cors] web_origins/extension_ids`，默认只允许同源 Web；跨源仅接受精确 HTTP(S) Origin 与 32 位 Chrome ID，拒绝通配符、`null`、额外方法/请求头且不开启 Cookie 凭据。单元、竞态及真实路由的 200/204/403 演练通过。
- [x] `SESSION-06` Web 客户端迁移到新会话，保留并测试旧 Token 兼容窗口。新增 `/api/v1/sessions/login`、`refresh` 与 Access 优先认证；Web 使用稳定设备 ID、15 分钟 Access/30 天 Refresh、单次自动刷新和 Web Locks 跨标签页协调。旧 `/api/login`/`token` 最晚于 `2026-11-07T00:00:00Z` 关闭，配置只能提前且无效值失败关闭。端点、中间件、截止边界、竞态和 PostgreSQL 登录→刷新→重放撤销实测通过。
- [x] `SESSION-07` 扩展迁移到新会话并安全升级原型凭据。Extension 登录改用设备会话，设备 ID、Access/Refresh Token 按服务器 Origin 隔离；启动时可将有效旧 Token 原子升级并立即删除服务端旧映射，网络失败保留凭据重试，明确失效时重新登录。多新标签页通过 Web Locks 与 Chrome 存储同步协调刷新；真实 PostgreSQL HTTP 演练已验证旧 Token 失效和新 Access 可用。
- [x] `SESSION-08` 覆盖登录、刷新、撤销、重放、过期、服务重启和多账号隔离测试。会话服务测试现已覆盖关闭并重开数据库连接后的 Access/Refresh 延续、同一 Refresh 并发提交的一胜一重放及整设备撤销；API/中间件测试覆盖登录刷新、升级后旧 Token 删除、截止边界、设备撤销和跨账号隔离，并纳入 `-race`。

## P3：同步与本地缓存

- [x] `SYNC-01` 定义版本化 bootstrap 响应和前端类型。首版契约包含 schemaVersion、字符串 revision、生成时间、安全账号摘要、面板配置、搜索引擎及已嵌套卡片的有序分组；Go DTO/JSON 契约测试与 TypeScript 类型保持同名字段，明确排除密码、Token、内部 JSON 和冗余用户 ID。能力开关由 `SYNC-03` 在端点上线后发布。
- [x] `SYNC-02` 为同步资源增加 revision/更新时间迁移。分组、卡片和用户配置增加可移植的 64 位 revision（旧数据默认 0），用户配置补充自动更新时间；SQLite 旧表升级测试验证数据保留，逻辑备份仅对白名单迁移列提供向后恢复兼容。本机 PostgreSQL 17.10 实迁移确认 revision 为 `BIGINT NOT NULL DEFAULT 0`、更新时间为 `timestamptz`。
- [x] `SYNC-03` 实现 `sync/bootstrap` 聚合接口，减少新标签页请求数量。新增仅接受设备 Access Token 的 `GET /api/v1/sync/bootstrap`，支持 API 版本协商，一次按账号聚合安全摘要、配置、搜索引擎及嵌套卡片的有序分组；空账号原子创建默认分组。测试覆盖账号隔离、排序、敏感字段、旧 Token 拒绝、版本拒绝和默认分组迁移，本机 PostgreSQL 登录→bootstrap HTTP 演练通过后才开启能力标志。
- [x] `SYNC-04` 扩展缓存最近一次完整快照并校验格式版本。Extension 在线加载首页时并行请求 bootstrap，只有完整通过校验才替换缓存；StorageAdapter 先按服务器 Origin 分区，缓存键再按账号 ID 隔离，信封重复记录并核对作用域。读写校验覆盖 cache/schema 版本、revision、时间、字段、ID 唯一性、卡片分组归属、10 万卡片及 5 MiB 上限，损坏或跨作用域缓存自动删除；独立验证脚本纳入 `build:all`。
- [x] `SYNC-05` 实现缓存首屏、后台刷新、离线标识和重试退避。Extension 在首次渲染前同步应用按 Origin/账号校验的快照，后台只通过 bootstrap 更新界面与缓存；传输失败按 0/1/3 秒最多尝试三次，认证/API 响应不重试，浏览器恢复在线或用户点击状态胶囊时立即重试。有缓存失败显示离线缓存，无缓存明确不可用；非在线状态关闭编辑入口，避免误导为支持离线写入。重试边界纳入缓存验证脚本。
- [x] `SYNC-06` 实现增量 changes 接口和客户端 revision 游标。新增账号级 `user_sync_state`/`user_sync_change`、事务内单调 revision 与有序分页；设备会话保护的 `GET /api/v1/sync/changes` 支持默认 200/最大 500、字符串游标、账号隔离、删除空载荷和游标超前 bootstrap 回退。客户端严格校验页结构和 revision 顺序，以已应用快照 revision 作为唯一可信游标，暂不推进未应用游标。派生日志不进入逻辑备份，恢复会在同一事务清除旧日志并按资源最大 revision 重建基线；本机 PostgreSQL 17.10 实迁移确认两张表、`BIGINT` revision、唯一约束和查询索引。
- [x] `SYNC-07` 写操作携带 revision，服务端拒绝静默覆盖冲突。分组、卡片、批量导入、删除、排序和面板配置统一携带账号级 `expectedRevision`；服务端锁定账号同步状态，在同一事务分配新 revision、写业务数据和 changes 日志，陈旧写入返回 `1502` 并完整回滚。前端仅在校验响应后推进 revision，冲突时自动重新 bootstrap。测试覆盖回滚、陈旧写拒绝、账号隔离、跨账号分组绑定和竞态检测。
- [x] `SYNC-08` 覆盖双端一致性、旧缓存升级、损坏缓存和离线恢复测试。Extension 从可信快照 revision 连续拉取 changes，逐页校验游标、资源 ID、payload 和资源归属，在内存完整应用全部分页后才单键持久化；任一缺页、损坏、游标异常、存储失败或中途离线均保留旧快照并回退 bootstrap。缓存信封从 v1 自动升级为带显式 `cursorRevision` 的 v2，独立验证覆盖分组更新保留子项、卡片跨组移动、损坏 payload、分页原子性、旧缓存迁移和断线重试。

## P4：共享前端与双端体验

- [x] `SHARED-01` 将平台无关的面板逻辑从页面组件抽到共享核心。新增 `src/dashboard/core.ts`，统一 bootstrap 到面板状态的映射、分组规范化、搜索过滤、排序请求和 LAN/WAN 地址选择；首页只负责 Vue 交互和运行时副作用，Web/Extension 共用同一套纯逻辑。搜索结果保留稳定分组 ID 与标题，修复过滤后按数组索引编辑错组的隐患，独立验证已纳入 `build:all`。
- [ ] `SHARED-02` 所有本地存储通过 StorageAdapter，清除误名 `ss` 但实际使用 localStorage 的历史实现。
- [ ] `SHARED-03` 所有 URL 打开行为通过 RuntimeAdapter，并拒绝危险协议。
- [ ] `SHARED-04` API 客户端支持同源 Web 与可配置扩展 Origin。
- [ ] `SHARED-05` Web 和扩展分别懒加载管理功能，控制新标签页首屏体积。
- [ ] `SHARED-06` 增加运行环境、网络、离线、同步和会话状态 UI。
- [ ] `SHARED-07` 完成桌面、窄屏、高 DPI、浅色/深色主题回归。

## P5：iTab 风格组件框架

- [ ] `WIDGET-01` 定义组件注册表、配置 schema、尺寸、位置和版本迁移。
- [ ] `WIDGET-02` 时钟、日期和搜索框迁入组件框架。
- [ ] `WIDGET-03` 增加天气组件及后端代理缓存。
- [ ] `WIDGET-04` 增加热搜/资讯组件及可替换数据源。
- [ ] `WIDGET-05` 增加倒计时/纪念日组件。
- [ ] `WIDGET-06` 支持组件拖放、缩放、隐藏和布局同步。
- [ ] `WIDGET-07` 对第三方接口实施超时、缓存、速率限制和降级展示。

## P6：离线编辑与冲突处理（增强阶段）

- [ ] `OFFLINE-01` 定义可重放 mutation 队列和幂等键。
- [ ] `OFFLINE-02` 对新增、编辑、删除、排序分别设计冲突语义。
- [ ] `OFFLINE-03` 提供冲突提示和用户选择，不采用最后写入静默覆盖。
- [ ] `OFFLINE-04` 测试多端离线修改、重复提交、部分失败和恢复。

## P7：发布与运维

- [ ] `RELEASE-01` 固定扩展 ID 或公钥策略，并配置生产扩展 Origin。
- [ ] `RELEASE-02` 完成最小权限审计、CSP、依赖和打包内容检查。
- [ ] `RELEASE-03` 编写隐私政策、数据用途、账号删除和支持文档。
- [ ] `RELEASE-04` 建立 Web 镜像与扩展 ZIP 的自动构建和校验和。
- [ ] `RELEASE-05` 建立 Chrome Web Store 手工发布清单，密钥不得进入仓库或 CI 日志。
- [ ] `RELEASE-06` 建立升级、回滚、API 兼容矩阵和最低后端版本提示。

## 官方公开功能对齐

完成双端 P1 原型后并行恢复以下顺序，具体条目以 `OPEN_FEATURE_PARITY.md` 为准：

1. `BRAND-*` 与 `OPS-01`
2. `IMAGE-*`
3. `AUTH-*`，其中设备会话由 P2 先行完成
4. `DOCKER-*` 与 Docker 相关 `CARD-*`
5. 其余 `CARD-*`、`SEARCH-*`
6. `API-*` 与其余 `OPS-*`

## 每次提交的完成条件

- [ ] 只包含当前条目相关改动，未覆盖其他设备或用户的未提交工作。
- [ ] 更新本文件中的状态、实现位置和必要的迁移说明。
- [ ] Go 代码执行 `go test ./...` 与 `go vet ./...`。
- [ ] 前端执行 `pnpm run type-check` 和对应的 Web/Extension 生产构建。
- [ ] 数据库、认证或同步改动包含失败、回滚和跨账号隔离测试。
- [ ] 提交信息清晰，并推送到远端开发分支。

## 在另一台设备继续

```powershell
git clone https://github.com/RoaycL/panel-next.git
cd panel-next
git fetch origin
git switch codex/open-feature-parity
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install
pnpm run type-check
pnpm run build-only
```

后端需要 Go 1.26 或项目届时记录的更新版本。Windows 上 `go-sqlite3` 测试还需要启用 CGO 并安装 MinGW-w64 GCC。继续开发前依次阅读：

1. `TODO.md`
2. `doc/web_extension_architecture.md`
3. `OPEN_FEATURE_PARITY.md`
4. `doc/backup_restore_fork.md`

## 当前下一步

`EXT-08` 等具备桌面 Chrome 环境后再人工验收，不阻塞后续开发。同步主链 `SYNC-01` 至 `SYNC-08` 与 `SHARED-01` 已完成，当前推进 `SHARED-02`：统一历史本地状态到 StorageAdapter，并清理误名 `ss` 的 localStorage 封装。
