# Sun-Panel 开放功能对齐路线图

> 项目新增 Web/Chrome 扩展双端方向。跨设备执行入口见 `TODO.md`，架构与安全决策见 `doc/web_extension_architecture.md`。双端基础不会取消本文件中的公开功能对齐任务；实现顺序调整为先完成最小扩展原型，再继续品牌和后续能力包。

## 1. 范围与边界

- 开源基线：`v1.3.0`（2024-01-30，最后一个 MIT 源码版本）。
- 当前对齐目标：`v1.8.1`（2025-12-31，当前最新 v1 正式版本）。
- `v2.0.0-dev-*` 是独立开发版本，不纳入本轮 v1 对齐；待 v1 清单完成后另行评估。
- 只依据 MIT 源码、官方公开文档、公开发行说明和可观察行为独立实现。
- 不下载闭源二进制用于分析，不反编译、不反汇编、不提取资源、不复制闭源代码。

统计口径：把正式版日志中可独立验收的新增或显著增强合并为“能力包”；纯 Bug 修复、文案微调和已经在后续正式版撤回的功能不计入。按此口径，`v1.3.0 -> v1.8.1` 共确认 **9 条功能线、53 个能力包**。其中 PRO 功能也只作为公开行为目标，不复刻授权机制。

## 2. 公开证据

- [官方 v1 正式版更新日志](https://doc.sun-panel.top/zh_cn/update/update_log.html)
- [官方 v1 Beta 更新日志](https://doc.sun-panel.top/zh_cn/update/update_log_beta.html)
- [GitHub Releases](https://github.com/hslr-s/sun-panel/releases)
- [迁移、备份、恢复说明](https://doc.sun-panel.top/zh_cn/usage/backup.html)
- [HTTPS 配置说明](https://doc.sun-panel.top/zh_cn/advanced/https.html)
- [OpenAPI 文档](https://doc.sun-panel.top/zh_cn/openapi/v1/apis.html)
- [部署说明](https://doc.sun-panel.top/zh_cn/usage/quick_deploy)
- [常见问题](https://doc.sun-panel.top/zh_cn/faq/faq.html)

证据冲突时以正式版更新日志和当前公开文档为准。Beta 日志只用于补充正式版中“包含此前 Beta 内容”但未展开的细节。

## 3. 按版本统计

| 版本 | 主要新增能力 | 对齐重点 |
| --- | --- | --- |
| v1.4.0 | OpenAPI、全局标题/图标/登录背景、在线编辑全局 JS/CSS、新图片格式、配置目录调整 | 设置模型、静态资源与兼容迁移 |
| v1.5.0–v1.5.3 | Docker 管理器、Docker/内置应用卡片、搜索组件与自定义引擎、版本检查、卡片缓存、分组增强 | Docker 接口、卡片模型、缓存 |
| v1.6.0–v1.6.1 | 多账号切换、验证码、多窗口系统、搜索快捷键、Docker 排序 | 会话隔离与窗口状态 |
| v1.7.0 | 状态详情、个性化开关、智能地址、Docker 权限、原生 HTTPS、OpenAPI 分组接口、上传分类、Web 静态目录 | 权限、安全与接口扩展 |
| v1.8.0 | 搜索引擎排序、完整地址右键菜单、备份恢复、图库与公共图库 | 数据安全与共享资源 |
| v1.8.1 | 首页加载条、右键菜单图标、Docker 重启/刷新、请求与缓存性能、`/clear` | 性能和故障恢复 |

特别说明：v1.7.0 Beta 曾加入基于 Cache Storage 的离线页面缓存，但在正式版前因严重兼容问题被移除，因此本项目不把它列为对齐目标。v1.8.1 的“卡片本地数据缓存与合理配额”仍在范围内。

## 4. 53 个能力包清单

所有条目默认状态为 `待实现`。实现后必须改为 `已实现`，并补充代码位置、测试和与公开行为的差异说明。

### A. 数据备份、恢复与迁移（3）

- [x] `DATA-01` 管理员导出完整备份 ZIP，覆盖 SQLite 数据库、上传目录和全局自定义样式目录。实现：版本化 manifest、SHA-256 校验、管理员下载 API 与前端入口。
- [x] `DATA-02` 从备份 ZIP 恢复/迁移上述数据，并给出明确的成功、失败与重启提示。实现：上传校验、恢复前快照、重启前排队、启动时原子替换与失败回滚。
- [x] `DATA-03` 覆盖所有账号的配置、图标和壁纸；对外部 MySQL 明确提示并提供 Panel Next 的可移植逻辑导出方案。实现：SQLite 使用一致性快照；MySQL 将 7 张核心业务表导出为带白名单和模式校验的逻辑 JSON，在目标 MySQL 实例事务内恢复；上传目录与自定义目录随同迁移。代码：`service/lib/backup/logical.go`、`service/api/api_v1/system/backup.go`、`service/initialize/pendingRestore.go`。测试：逻辑格式/模式拒绝、真实 SQLite 往返、MySQL 布局和恢复钩子失败回滚。

Panel Next 必做安全增强（不计入 53 个官方能力包）：版本化 manifest、哈希校验、压缩炸弹限制、路径穿越防护、未知未来格式拒绝、恢复前自动快照、SQLite/MySQL 一致性恢复和失败回滚。

### B. 全局品牌与个性化（6）

- [x] `BRAND-01` 全局站点标题。实现：`systemSetting.SITE_TITLE` + 管理员 `GET/POST /api/siteSetting/get|set` + 公开 `GET /api/siteInfo`；首页 HTML 动态注入 `<title>`（`service/router/indexPage.go`），无默认标题闪烁。代码：`service/api/api_v1/system/siteSetting.go`、`service/router/indexPage.go`。测试：注入转义、默认保留、缺失 favicon 兜底。
- [x] `BRAND-02` 全局 favicon/站点图标，并在保存刷新后立即生效且不闪烁默认标题。实现：`SITE_FAVICON` 同源路径校验 + 首页 HTML `<link rel="icon">` 动态替换 + 登录页运行时注入 favicon。保存后刷新即生效（`no-cache` 响应头），无需重新部署。与 BRAND-01 共用注入与测试。
- [x] `BRAND-03` 自定义登录页背景图。实现：`LOGIN_BACKGROUND` 同源路径 + `GET /api/siteInfo` 返回 + 登录页 `onMounted` 拉取并应用背景样式。管理员 SiteSetting 应用上传与设置。
- [x] `BRAND-04` 在线编辑全局 `index.js` 与 `index.css`，保留文件方式配置。实现：`GLOBAL_INDEX_CSS`/`GLOBAL_INDEX_JS` 设置项，管理员可在线编辑并保存到 DB（上限 256KB）；首页 HTML 注入时 DB 有值则内联 `<style>`/`<script>` 替换 `/custom/index.*` 引用，DB 为空则保留文件方式。SiteSetting 应用提供 textarea 编辑器（等宽字体）。代码：`service/router/indexPage.go`、`src/components/apps/SiteSetting/index.vue`。测试：内联替换、空值保留文件引用。
- [x] `BRAND-05` 壁纸上传支持 AVIF；HEIC 在运行环境可可靠解码时启用，否则明确报错。实现：UploadImg/UploadFiles 白名单增加 `.avif`；`.heic`/`.heif` 拒绝并返回 1301（不支持格式）；前端 Style/SiteSetting 上传 accept 属性加 `.avif`。AVIF 服务端存储原样、浏览器原生支持解码；HEIC 当前不引入解码库，明确拒绝。代码：`service/api/api_v1/system/file.go`、`src/components/apps/Style/index.vue`、`src/components/apps/SiteSetting/index.vue`。测试：AVIF 接受、HEIC 拒绝。
- [x] `BRAND-06` 导航页 Logo、时钟独立显示开关。实现：`panelConfig` 新增 `logoShow`/`clockShow` 布尔字段（默认 true），首页 header 根据开关控制 Logo 文字与 ClockWidget 显隐；分隔符仅在两者均显示时渲染。Style 设置应用新增"显示 Logo"与"显示时钟"开关，时钟秒数开关改为依赖时钟显示。代码：`src/views/home/index.vue`、`src/components/apps/Style/index.vue`、`src/store/modules/panel/helper.ts`、`src/typings/panel.d.ts`。

“登录页文字”暂未在正式版公开日志中找到可靠证据，先列为候选增强，不计入对齐统计；取得公开证据或用户确认后再排期。

### C. 图库与公共图库（6）

- [x] `IMAGE-01` 将上传文件管理升级为图库，并按图标/壁纸分类查询。实现：`models.File` 新增 `Type` 字段（icon/wallpaper/other），`GetList` 支持 `type` 查询参数过滤，`UploadImg` 支持 `fileType` 表单字段，`UploadFileManager` 增加分类筛选标签和上传类型选择。代码：`service/models/file.go`、`service/api/api_v1/system/file.go`、`src/components/apps/UploadFileManager/index.vue`。
- [x] `IMAGE-02` 按分类单张和批量上传图片。实现：上传接口支持 `fileType` 参数指定分类，前端 UploadFileManager 提供上传类型下拉选择。
- [x] `IMAGE-03` 查看图片详情并修改图片类型。实现：新增 `POST /api/file/updateType` 接口，前端图片卡片增加类型修改下拉菜单，详情弹窗显示类型字段。
- [x] `IMAGE-04` 复制可公开访问的图片链接，作为简易图床使用。实现：UploadFileManager 每张图片已有复制链接按钮（`copyImageUrl`），结合外部图床配置（IMAGE 集成）上传的图片返回完整可公开访问 URL。
- [x] `IMAGE-05` 所有图标和壁纸选择位置接入统一图库选择器。实现：新增 `GallerySelector` 统一组件，支持分类筛选与点击选中；IconEditor 图标图片选择接入图库选择器；Style 壁纸选择接入图库选择器。代码：`src/components/common/GallerySelector/index.vue`、`src/views/home/components/EditItem/IconEditor.vue`、`src/components/apps/Style/index.vue`。
- [x] `IMAGE-06` 管理员维护公共图库，所有账号只读选择使用。实现：新增 `PublicFile` 模型（纳入 AutoMigrate 和逻辑备份白名单），管理员 API（上传/删除/修改类型，AdminInterceptor 保护），所有登录用户可读 API（`GET /publicFile/getList`）；`PublicGallery` 管理应用（管理员专用，AppStarter 注册）；`GallerySelector` 支持个人图库与公共图库标签切换。代码：`service/models/publicFile.go`、`service/api/api_v1/system/publicFile.go`、`service/router/system/publicFile.go`、`src/components/apps/PublicGallery/index.vue`、`src/components/common/GallerySelector/index.vue`。

### D. 登录、账号与窗口体验（6）

- [ ] `AUTH-01` 保存多个相互隔离、可撤销的登录会话并快速切换账号。
- [ ] `AUTH-02` 已失效会话切换时进入重新认证流程，避免重复账号记录。
- [ ] `AUTH-03` 登录验证码，支持可配置启用条件、刷新、过期和失败限制。
- [ ] `AUTH-04` 已登录用户访问登录页时直接进入首页。
- [ ] `AUTH-05` 内置弹窗支持拖动、缩放、多窗口并存和移动端全屏。
- [ ] `AUTH-06` 账号管理清晰标识当前账号与公开访问账号，并保持角色隔离。

### E. Docker 管理与 Docker 卡片（7）

- [ ] `DOCKER-01` 通过本机或挂载的 Docker Socket 检测能力并列出容器与状态。
- [ ] `DOCKER-02` 管理员启动、停止和重启容器，返回 Docker 的真实错误原因。
- [ ] `DOCKER-03` 容器列表按名称和状态排序，并提供手动刷新。
- [ ] `DOCKER-04` Docker 容器卡片显示状态并支持卡片操作。
- [ ] `DOCKER-05` 容器更新导致 ID 变化时，仅在已登录状态按名称安全重绑定。
- [ ] `DOCKER-06` 从 Docker 管理器快速创建容器卡片；从应用启动器快速创建内置应用卡片。
- [ ] `DOCKER-07` 普通账号不可访问 Docker 管理器、创建 Docker 卡片或控制容器；只允许查看已有卡片状态。

### F. 卡片、分组与导航交互（10）

- [ ] `CARD-01` 新增 Docker 卡片和内置应用卡片类型。
- [ ] `CARD-02` 卡片编辑器直接删除卡片，并使用默认普通卡片与“更多选项”简化编辑流程。
- [ ] `CARD-03` 鼠标中键在新窗口打开卡片地址。
- [ ] `CARD-04` 分组样式独立配置、公开模式隐藏、唯一标识及稳定 CSS class。
- [ ] `CARD-05` 卡片数据本地缓存、加载指示和受控缓存空间分配。
- [ ] `CARD-06` iframe 中“本页打开”使用父窗口打开。
- [ ] `CARD-07` 网站返回多个候选图标时允许用户选择，并改进第三方图标获取。
- [ ] `CARD-08` 实验性智能选择内网/默认地址，包含延迟、加载状态和已知限制提示。
- [ ] `CARD-09` 右键菜单展示所有已填写地址，并支持新窗口、小窗口和当前页三种打开方式。
- [ ] `CARD-10` 右键菜单图标化，并为 Docker 卡片提供重启入口。

### G. 搜索组件（4）

- [ ] `SEARCH-01` 搜索框样式设置和不受商业授权数量限制的自定义搜索引擎。
- [ ] `SEARCH-02` 公开访问模式允许临时切换引擎，但隐藏设置入口且刷新后恢复默认值。
- [ ] `SEARCH-03` 导航页按 `/` 快速聚焦搜索框，同时不干扰编辑输入框。
- [ ] `SEARCH-04` 搜索引擎拖动排序并持久化。

### H. OpenAPI（5）

- [ ] `API-01` OpenAPI v1 全局鉴权、错误码和卡片创建/查询/更新接口。
- [ ] `API-02` 卡片分组创建、列表和详情接口。
- [ ] `API-03` 创建卡片时支持保存远程图标到本地，并按分组 ID 或唯一名绑定。
- [ ] `API-04` 卡片更新采用补丁语义，未传字段保持原值。
- [ ] `API-05` 无参数版本/连通性接口，返回版本字符串与版本序号。

### I. 运行、配置、状态与诊断（6）

- [x] `OPS-01` 配置与 Docker 挂载收敛到 `conf`，同时兼容 v1.3.0 旧路径并支持自定义 Web/custom 目录。实现：`conf/conf.ini` 新增 `base.web_path` 配置项（默认 `./web`），路由从配置读取 Web 静态根目录；`source_path`、`sqlite.file_path` 已可配置，建议 Docker 部署时挂载整个 `conf/` 目录并在其中放置 `files/`、`database.db`、`conf.ini`；旧路径 `./web`、`./uploads`、`./database.db` 仍为默认值保持兼容。`conf.example.ini` 增加 Docker 挂载建议注释。代码：`service/router/A_ENTER.go`、`service/initialize/config/config.go`、`service/conf/conf.example.ini`。
- [ ] `OPS-02` 登录令牌有效期可配置，默认 168 小时并延续滑动续期。
- [ ] `OPS-03` 原生 HTTPS：可配置监听端口、证书和私钥路径，未配置证书时不启用。
- [ ] `OPS-04` Web 根目录可托管 `robots.txt` 等额外静态文件，并确保路径安全。
- [ ] `OPS-05` 在线检查新版本但不执行在线升级；关于页提供管理员运行诊断信息。
- [ ] `OPS-06` `/clear` 清理前端本地缓存并要求重新登录；系统状态支持详情、CPU 平均值和磁盘自定义标题。

## 5. 实现顺序

实现不严格照版本号，而按依赖和风险排序：

1. `DATA-*`：备份、恢复、迁移与安全增强（已完成，真实 MySQL 演练待补）。
2. `DUAL/EXT P0-P1`：建立 Web/Chrome 双端边界并跑通最小新标签页原型，详见 `TODO.md`。
3. `BRAND-*` + `OPS-01`：全局设置和配置目录迁移，同时保证 Web/Extension 共用。
4. `IMAGE-*`：图库、分类和公共图库。
5. `AUTH-*` 与 `SESSION-*`：设备会话、验证码、多账号切换和窗口系统。
6. `DOCKER-*` + Docker 相关 `CARD-*`：Docker 管理和权限。
7. 其余 `CARD-*`、`SEARCH-*`：导航交互、缓存和搜索。
8. `API-*` + 其余 `OPS-*`：OpenAPI、HTTPS、静态目录和诊断。

每阶段都需要：数据库迁移、后端单元/集成测试、前端类型检查、生产构建、升级/回滚说明和人工验收记录。不得为了行为对齐引入远程授权或付费依赖。

## 6. 第一阶段验收门槛

- ZIP 中只包含版本化 manifest 与明确白名单内的数据。
- 导出期间数据库与文件视图一致；导入前验证格式、版本、校验和、大小及路径。
- 默认先创建可恢复快照，再以临时目录和原子替换完成恢复；失败时保持原实例可用。
- SQLite 与 MySQL 都有明确策略，不能把数据库文件复制方案误用于 MySQL。
- 只有管理员可以导出或恢复；敏感操作写审计日志并限制并发。
- 自动化测试至少覆盖：正常往返、损坏 ZIP、路径穿越、未知版本、缺失文件、超限文件、恢复中断和回滚。

### 第一阶段验收记录（2026-08-09）

- Go 1.26.4、Windows amd64、CGO/MinGW-w64 环境下，`go test ./...` 与 `go vet ./...` 通过。
- 前端 `vue-tsc --noEmit` 与 Vite 8 生产构建通过。
- SQLite：数据库快照覆盖所有业务表；备份库自动化测试覆盖 ZIP 校验、路径安全、格式版本、缺失/超限条目、文件替换和失败回滚。
- MySQL：实现同版本 Sun-Panel MySQL 实例之间的逻辑迁移；导入前严格匹配表和列白名单，导入在事务中执行，文件阶段失败或数据库阶段失败均保留待恢复包并回滚已替换文件。
- 管理端导出/恢复接口由登录与管理员中间件保护；同一进程一次只允许一个备份或恢复请求，并写入包含操作、状态、用户 ID 和来源 IP 的审计日志。
- 环境限制：本机没有 MySQL 服务或 Docker，因此没有执行真实 MySQL 服务集成测试；逻辑数据库公共路径已通过真实 SQLite 驱动往返测试，MySQL 时间字段转换、布局及失败回滚由单元测试覆盖。部署到 MySQL 前仍应在测试实例完成一次演练。

## 7. 维护规则

- 每次开始一个能力包前，先在本文件记录公开证据和可观察验收条件。
- 如果只能推测闭源内部设计，则停止推测，选择符合公开行为且更安全、可维护的独立设计。
- 后续上游发布新的 v1 正式版时，新增一行版本统计并追加能力包；不要静默扩大当前阶段范围。
