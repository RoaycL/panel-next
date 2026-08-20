# Panel Next 主待办清单

本文是跨设备继续开发的唯一执行入口。功能对齐的详细证据见 `OPEN_FEATURE_PARITY.md`，双端设计见 `doc/web_extension_architecture.md`。

## 当前状态

- 状态更新时间：`2026-08-20`。
- 当前开发分支：`main`（多人协作通过功能分支和 Pull Request 合入）。
- 已完成：前端工具链升级、SQLite 完整备份恢复、MySQL/PostgreSQL 逻辑备份迁移、Web/Chrome 双端基础、全部 53 个官方公开功能能力包。
- 双端布局：Web 保持原导航布局；Extension 已建立专用新标签页路由与响应式玻璃分组布局，底层数据和卡片交互继续共享。
- 最近验证：后端 `go test ./...`、`go vet ./...` 全部通过；前端 ESLint 零错误、TypeScript 类型检查零错误、8 项前端架构校验全部通过、Web/Extension 生产构建和扩展包校验通过。
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
- [x] `SHARED-02` 所有本地存储通过 StorageAdapter，清除误名 `ss` 但实际使用 localStorage 的历史实现。应用、认证、面板、用户、公告和模块配置统一使用 `persistentStorage`，底层只访问当前 Runtime 的 StorageAdapter；保留原键名与 JSON 信封以兼容现有数据，移除 `ss`/`ls` 别名和死代码，并为读取接口补充泛型类型。架构验证现在阻止业务代码直接访问浏览器存储或重新引入旧别名。
- [x] `SHARED-03` 所有 URL 打开行为通过 RuntimeAdapter，并拒绝危险协议。RuntimeAdapter 新增统一的安全导航解析，Web/Extension 打开动作与卡片 iframe 共用 HTTP(S) 白名单；应用根节点捕获静态链接、用户自定义 footer 链接及新标签/辅助点击并交给适配器处理。Blob 下载保持独立下载语义，架构规则禁止业务代码直接调用 `window.open`，独立验证覆盖相对地址与 `javascript:`、`data:`、`file:`、`mailto:` 拒绝。
- [x] `SHARED-04` API 客户端支持同源 Web 与可配置扩展 Origin。Axios 请求拦截器按请求动态读取 Runtime API baseURL；验证码公共组件与图标/壁纸上传不再写死当前页面 `/api`，统一解析到 Web 同源或 Extension 已授权服务器 Origin。上传同时发送标准 Bearer 与兼容 token，架构验证禁止重新引入字面量 `/api` 上传 action。
- [x] `SHARED-05` Web 和扩展分别懒加载管理功能，控制新标签页首屏体积。路由继续按 Runtime 分离 Web 首页与 Extension 外壳，管理应用由 AppLoader 动态分块；首页不再通过 barrel 静态引入 AppStarter 与 EditItem，只有用户打开管理器或编辑卡片时才下载并挂载。静态依赖边界验证已纳入 `build:all`，同时覆盖两个按需入口及管理应用动态 import。
- [x] `SHARED-06` 增加运行环境、网络、离线、同步和会话状态 UI。首页新增 Web/Chrome 双端共用状态栏，展示运行端、浏览器在线/离线、公开/兼容/设备会话及到期时间；Extension 同栏展示缓存/同步/离线/不可用状态并保留点击重试。双端统一监听 online/offline 生命周期，状态 UI 验证纳入 `build:all`。
- [x] `SHARED-07` 完成桌面、窄屏、高 DPI、浅色/深色主题回归。真实浏览器检查覆盖桌面与 390×844 窄屏、深色主题和窄屏管理弹窗，关键元素均在视口内；修复模糊背景层造成的约 10px 横向绘制溢出，并为设置入口补齐可访问标题。静态回归锁定 640px 断点、状态栏换行/裁剪、响应式字号、SVG 图标和系统浅/深主题钩子，Web/Extension 生产构建共同验收。

## P5：iTab 风格组件框架

- [x] `WIDGET-01` 定义组件注册表、配置 schema、尺寸、位置和版本迁移。新增共享 WidgetRegistry 与 v1 布局信封，组件定义包含稳定 type、当前版本、配置解析器、默认配置、异步 loader、默认/最小/最大网格尺寸及逐版本迁移；实例包含稳定 ID、网格位置、尺寸、隐藏状态和配置。加载时隔离未知、重复或损坏实例，尺寸安全收敛，验证覆盖注册冲突、配置 schema、迁移链、边界和未来版本拒绝。
- [x] `WIDGET-02` 时钟、日期和搜索框迁入组件框架。注册 `core.clock`、`core.date`、`core.search` 三个内置组件定义，各自声明配置 schema、默认配置、网格尺寸和异步 loader；通用 WidgetHost 负责按 type 加载、配置/事件透传、隐藏和加载失败隔离。首页头部改由注册表实例渲染时钟与搜索，旧 `clockShowSecond`/`searchBoxShow` 配置继续兼容，日期可作为独立实例或时钟组合显示。
- [x] `WIDGET-03` 增加天气组件及后端代理缓存。注册 `core.weather` 内置组件，支持城市、公制/英制配置、WMO 天气状态、本地化、手动/定时刷新、加载失败及过期缓存降级展示；首页在 Web/Extension 各自响应式布局中异步加载天气。新增公开 Go 代理 `/api/v1/widgets/weather`，服务端固定访问 Open-Meteo 地理编码与实时天气接口，实施输入校验、5 秒超时、响应体上限、10 分钟内存缓存和 6 小时陈旧缓存降级，客户端不保存服务密钥，并按数据许可保留来源署名。同步修复兼容会话误调用设备同步接口导致退出，以及懒加载卡片编辑器首次打开未初始化分组的问题。
- [x] `WIDGET-04` 增加热搜/资讯组件及可替换数据源。注册 `core.trending` 内置组件，配置支持在 `weibo`/`baidu`/`zhihu`/`hackernews` 数据源中选择并限制条数；新增公开 Go 代理 `GET /api/v1/widgets/trending?source=&limit=`，`service/lib/trending` 以 Provider 接口聚合数据源（可注册/替换），实施输入校验、5 秒超时、响应体上限、5 分钟内存缓存、6 小时陈旧缓存降级与空结果回退；客户端不保存服务密钥，条目链接经根节点统一交给 RuntimeAdapter 打开。测试覆盖各数据源归一化、缓存、陈旧降级、输入校验、同名 Provider 替换和竞态检测，注册表校验脚本已覆盖 trending。
- [x] `WIDGET-05` 增加倒计时/纪念日组件。注册 `core.countdown` 内置组件，配置包含标题（1–40 字符）、严格 `YYYY-MM-DD` 本地日期（日历回写校验、年份 ≥1900）与 `none`/`yearly` 重复模式；`yearly` 自动滚动到下一次周年日（非闰年 2 月 29 日收敛到当月最后一天），到期当天显示“就是今天”，过期单次事件显示已过去天数。组件纯本地计算、每分钟跨日刷新、独立懒加载分块，无网络请求与后端依赖；首页与热搜组件同行放置，双端共用。注册表校验脚本已覆盖 countdown。
- [x] `WIDGET-06` 支持组件拖放、缩放、隐藏和布局同步。首页组件区改为 12 列网格，登录后提供编辑模式：拖拽手柄排序（vue-draggable）、按定义尺寸边界缩放列/行、隐藏/显示、移除与从注册表新增实例；布局以 v1 信封存入 `panelConfig.widgets`（`user_config.panel_json`），经既有 `userConfig/set` mutation 携带 `expectedRevision` 同步，冲突走既有 bootstrap 重载；布局随 bootstrap/增量同步刷新，编辑中的未保存改动不被后台覆盖；损坏/未知/重复实例加载时隔离并回退默认布局。同步修复 `userConfig/set` 只提交一段配置时把另一段覆写为 `null` 的缺陷（未提交段保持原值，回归测试覆盖）。窄屏组件单元格全宽展示。
- [x] `WIDGET-07` 对第三方接口实施超时、缓存、速率限制和降级展示。天气与热搜代理统一具备 5 秒超时、1 MiB 响应上限、TTL 内存缓存（天气 10 分钟/热搜 5 分钟）与 6 小时陈旧缓存降级；新增 `service/lib/ratelimit` 固定窗口限流器（按 key 计数、窗口重置、Retry-After、过期清理、并发安全），公开组件端点 `/api/v1/widgets/*` 按客户端 IP 每分钟 30 次（天气+热搜合计），超限返回 `1600` 与 `Retry-After` 响应头；客户端对限流响应静默降级为组件“暂不可用”状态（保留已有数据），不弹全局错误。单元、HTTP 中间件与竞态测试通过。

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

`OPEN_FEATURE_PARITY.md` 中 53 个能力包已全部完成（截至 `2026-08-20`）：

1. `DATA-01` 至 `DATA-03`（3/3）✓
2. `BRAND-01` 至 `BRAND-06`（6/6）✓
3. `IMAGE-01` 至 `IMAGE-06`（6/6）✓ + 外部图床集成
4. `AUTH-01` 至 `AUTH-06`（6/6）✓
5. `DOCKER-01` 至 `DOCKER-07`（7/7）✓
6. `CARD-01` 至 `CARD-10`（10/10）✓
7. `SEARCH-01` 至 `SEARCH-04`（4/4）✓
8. `API-01` 至 `API-05`（5/5）✓
9. `OPS-01` 至 `OPS-06`（6/6）✓

## 每次提交的完成条件

- [x] 只包含当前条目相关改动，未覆盖其他设备或用户的未提交工作。
- [x] 更新本文件中的状态、实现位置和必要的迁移说明。
- [x] Go 代码执行 `go test ./...` 与 `go vet ./...`。
- [x] 前端执行 `pnpm run type-check` 和对应的 Web/Extension 生产构建。
- [x] 数据库、认证或同步改动包含失败、回滚和跨账号隔离测试。
- [x] 提交信息清晰，并推送到远端开发分支。

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

`OPEN_FEATURE_PARITY.md` 中 53 个能力包已全部完成。双端基础架构（P0–P5）除 `EXT-08`（Chrome 手工验收待环境）和 P6（离线编辑增强阶段）外均已完成。后续工作重点：

1. `EXT-08`：具备桌面 Chrome 环境后手工验收扩展安装、新标签页覆盖、登录、卡片交互和重启恢复。
2. `OFFLINE-01` 至 `OFFLINE-04`：离线编辑与冲突处理（增强阶段，非阻塞）。
3. `RELEASE-01` 至 `RELEASE-06`：发布与运维（扩展 ID/CSP/隐私政策/自动构建/Chrome 商店发布/升级回滚兼容矩阵）。
4. 环境缺口：MySQL 真实恢复演练。
