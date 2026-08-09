# Panel Next 主待办清单

本文是跨设备继续开发的唯一执行入口。功能对齐的详细证据见 `OPEN_FEATURE_PARITY.md`，双端设计见 `doc/web_extension_architecture.md`。

## 当前状态

- 当前开发分支：`codex/open-feature-parity`
- 已完成：前端工具链升级、SQLite 完整备份恢复、MySQL 逻辑备份迁移。
- 当前主线：先建立 Web/Chrome 双端基础，再继续品牌、图库、组件和官方公开能力对齐。
- 最近验证：`go test ./...`、`go vet ./...`、`pnpm run type-check`、`pnpm run build-only` 均通过。
- 已知环境缺口：尚未在真实 MySQL 服务执行恢复演练。

## P0：架构与仓库准备

- [x] `DUAL-00` 记录 Web/Chrome 双端目标、边界、ADR、安全要求和完成定义。
- [x] `DUAL-01` 建立跨设备主待办清单和接手步骤。
- [ ] `DUAL-02` 为 Web 和 Extension 确定共享版本号、产物目录及发布命名规则。
- [ ] `DUAL-03` 增加架构约束测试，禁止共享核心直接依赖 `chrome.*` 或未经封装的存储 API。

## P1：最小扩展原型

- [ ] `EXT-01` 新建 Manifest V3 扩展入口，以 `newtab.html` 覆盖新标签页。
- [ ] `EXT-02` 增加 `RuntimeAdapter`、`StorageAdapter` 和 Web 实现，不改变现有行为。
- [ ] `EXT-03` 增加 Chrome 实现，使用 `chrome.storage.local` 保存非敏感配置和会话。
- [ ] `EXT-04` 支持配置、验证并切换 Sun-Panel 服务器地址。
- [ ] `EXT-05` 使用当前账号接口完成扩展登录验证，仅作为原型，明确标记待迁移认证。
- [ ] `EXT-06` 从现有 API 加载分组、卡片和面板配置，渲染共享首页。
- [ ] `EXT-07` 增加 `pnpm build:web`、`pnpm build:extension` 和扩展 ZIP 打包命令。
- [ ] `EXT-08` 在 Chrome 开发者模式手工验收：安装、覆盖新标签页、登录、打开卡片、重启浏览器后恢复。

P1 验收门槛：不得修改生产数据库结构；不得发布到 Chrome 商店；Web 功能必须保持兼容。

## P2：安全设备会话与跨源访问

- [ ] `SESSION-01` 设计并迁移 `user_session` 数据表。
- [ ] `SESSION-02` 实现哈希化 Access/Refresh Token、过期、轮换和重复使用检测。
- [ ] `SESSION-03` 实现多设备列表、单设备撤销和全部撤销。
- [ ] `SESSION-04` 新增客户端能力发现接口和 API 版本协商。
- [ ] `SESSION-05` 配置精确 CORS Origin、扩展 ID 白名单和预检请求。
- [ ] `SESSION-06` Web 客户端迁移到新会话，保留并测试旧 Token 兼容窗口。
- [ ] `SESSION-07` 扩展迁移到新会话并安全升级原型凭据。
- [ ] `SESSION-08` 覆盖登录、刷新、撤销、重放、过期、服务重启和多账号隔离测试。

## P3：同步与本地缓存

- [ ] `SYNC-01` 定义版本化 bootstrap 响应和前端类型。
- [ ] `SYNC-02` 为同步资源增加 revision/更新时间迁移。
- [ ] `SYNC-03` 实现 `sync/bootstrap` 聚合接口，减少新标签页请求数量。
- [ ] `SYNC-04` 扩展缓存最近一次完整快照并校验格式版本。
- [ ] `SYNC-05` 实现缓存首屏、后台刷新、离线标识和重试退避。
- [ ] `SYNC-06` 实现增量 changes 接口和客户端 revision 游标。
- [ ] `SYNC-07` 写操作携带 revision，服务端拒绝静默覆盖冲突。
- [ ] `SYNC-08` 覆盖双端一致性、旧缓存升级、损坏缓存和离线恢复测试。

## P4：共享前端与双端体验

- [ ] `SHARED-01` 将平台无关的面板逻辑从页面组件抽到共享核心。
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

从 `EXT-01` 开始，同时完成 `EXT-02`：先生成可加载但权限最小的 Chrome 新标签页包，并把现有 Web 存储和打开链接行为放到适配器后面。原型通过前不重构全部目录。
