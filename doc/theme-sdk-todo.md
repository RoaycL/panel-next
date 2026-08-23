# Panel Next Theme SDK 实施 TODO

> 状态：已实施并通过复审修复（v0.0.7 重新打包）。R1 五项（auto 深色重解析、预览完整覆盖与关闭清理、Web 保存原子回滚、Variant/图标包真实消费、主题包安全强化）与 R2 四项（legacyAdapter 接线、Token 深合并/深冻结、SearchWidget/Clock/Date 去硬编码、行为级测试替代源码断言）均已修复并有对应自动化验证。剩余未勾选项为 naive-ui 弹窗 Token 深度接线、主题预览图展示、ZIP 容器落地与人工视觉验收。
>
> 编写日期：2026-08-22
>
> 当前测试版本：0.0.6
>
> 目标：建立规范化、可供第三方开发、支持 Web 与 Chrome Extension、可驱动小组件和系统图标的 Theme SDK。

## 0. 执行约束

- [x] 开始前完整阅读本文件，不跳过安全、兼容和验收章节。
- [x] 检查当前工作区状态，保留所有已有未提交修改，不覆盖无关变更。
- [x] 完整检查现有主题、样式、扩展外观、Widget、图标、弹窗和个人中心代码。
- [x] 所有源文件修改使用 `apply_patch`，不使用脚本直接覆写源文件。
- [x] 不删除现有旧样式字段，先提供兼容适配器。
- [x] 不改变“分组和书签双端共享，样式、主题、组件布局双端分别保存”的产品边界。
- [x] 不实现运行时远程 JavaScript、任意 HTML、Vue 代码或远程脚本主题。
- [x] 普通测试和构建不修改版本号。
- [x] 只有全部测试通过并准备最终安装包时，才按测试版策略将 0.0.6 递增到 0.0.7。
- [x] 实施中如果发现本文件设计与现有架构冲突，先记录证据并采用兼容性最强的实现。

## 1. 现状审计

- [x] 查找所有直接读取 `panelConfig` 外观字段的页面和组件。
- [x] 查找所有硬编码颜色、圆角、阴影、模糊和动画时间。
- [x] 查找系统功能图标中硬编码的 Iconify/SVG 名称。
- [x] 区分系统语义图标、用户上传图片、favicon 和网站 Logo。
- [x] 检查 Web 首页、Extension 首页、个人中心、通知、确认框、设置弹窗和 Widget 外壳。
- [x] 列出现有字段：`backgroundImageSrc`、`backgroundBlur`、`backgroundMaskNumber`、`iconStyle`、`iconTextColor` 等。
- [x] 确认 Extension 外观仍通过 `EXTENSION_APPEARANCE_KEY` 本地保存。
- [x] 确认 Web 外观仍通过 `panelConfig` 和 `userConfig/set` 同步。
- [x] 输出一份硬编码样式迁移清单，作为后续 Token 化依据。

## 2. 建立目录与公共 Schema

- [x] 新增 `src/themes/types.ts`。
- [x] 新增 `src/themes/constants.ts`。
- [x] 新增 `src/themes/schema.ts`。
- [x] 新增 `src/themes/registry.ts`。
- [x] 新增 `src/themes/runtime.ts`。
- [x] 新增 `src/themes/cssVariables.ts`。
- [x] 新增 `src/themes/ThemeProvider.vue`。
- [x] 新增 `src/themes/ThemeSettingsModal.vue`。
- [x] 新增 `src/themes/ThemeIcon.vue`。
- [x] 新增 `src/themes/builtins/default.ts` 和入口文件。
- [x] 新增 `src/themes/index.ts`，只导出稳定公共 API。
- [x] 评估是否将 Widget 配置 Schema 提取到 `src/sdk/configSchema.ts`。
- [x] 如果提取公共 Schema，保留现有 Widget 导出路径的兼容 re-export。
- [x] 公共 Schema 错误信息不得继续写死为 “widget config”。

## 3. 定义主题契约

- [x] 定义 `ThemeDefinition<TConfig>`。
- [x] 定义 `ThemeMeta`，包含名称、描述、作者、主页和预览图。
- [x] 定义 `ThemeSurface = 'web' | 'extension'`。
- [x] 定义 `ThemeMode = 'light' | 'dark' | 'auto'`。
- [x] 定义 `ThemeContext`，包含 surface、实际明暗模式和运行环境信息。
- [x] 定义 `ThemeSelection` v1 信封。
- [x] 定义 `ThemeLoadResult`、隔离数据和可读问题列表。
- [x] 定义 `ThemeMigration` 连续迁移契约。
- [x] 固定主题 ID 规则为小写、最多 64 字符，推荐 `<vendor>.<name>`。
- [x] 保留 `core.` 前缀给内置主题。
- [x] 要求版本为大于等于 1 的 JavaScript 安全整数。
- [x] 重复主题 ID 注册必须抛错。
- [x] `surfaces` 缺省表示 Web 与 Extension 均可使用。

## 4. 定义完整 Theme Token

- [x] 定义页面背景、普通表面、浮层表面、悬停表面、遮罩和边框颜色。
- [x] 定义主文字、次级文字、弱化文字和强调色。
- [x] 定义 success、warning、danger 状态色。
- [x] 定义字体族、标题字重和正文字重。
- [x] 定义 small、medium、large、round 圆角。
- [x] 定义 compact、normal、relaxed 间距。
- [x] 定义 blur、三级 shadow 和动画时长。
- [x] 定义 Bookmark 专用 Token。
- [x] 定义 Widget 专用 Token，包括加载、错误和图表色板。
- [x] 定义 Sidebar 专用 Token。
- [x] 定义 Modal/Notification 专用 Token。
- [x] 定义 Icon 专用 Token。
- [x] 默认主题必须完整提供所有 Token。
- [x] 第三方主题允许提供部分覆盖，但解析结果必须用默认 Token 深度补齐。
- [x] Token 对象对组件只读，避免组件运行时修改全局主题。
- [x] 对颜色、长度、数字、字体和阴影值进行严格解析，不直接拼接任意 CSS。

## 5. CSS Variables 与 ThemeProvider

- [x] 实现稳定 Token → CSS Variable 映射。
- [x] CSS 变量统一使用 `--pn-` 前缀。
- [x] `ThemeProvider` 只把变量应用到 Panel Next 根容器，避免污染宿主页面。
- [x] 实现实际明暗模式解析，`auto` 跟随系统并响应变化。
- [x] 实现主题切换时的批量原子更新，避免逐变量闪烁。
- [x] 实现 `useTheme()`。
- [x] 实现 `useWidgetTheme()`。
- [x] 主题上下文缺失时自动回退 `core.default`。
- [x] 页面首次渲染前尽可能应用可信主题快照，减少主题闪烁。
- [x] 主题解析或应用异常时捕获错误并回退默认主题，禁止白屏。

## 6. ThemeRegistry

- [x] 实现 `register()`。
- [x] 实现 `get()`。
- [x] 实现按 surface 过滤的 `list()`。
- [x] 实现 `createSelection()`。
- [x] 实现连续版本迁移 `migrate()`。
- [x] 实现 `loadSelection()`。
- [x] 实现 `resolve()`，输出完整 Token、图标和 Variant。
- [x] 实现 `serialize()`。
- [x] 注册时校验默认配置、Token、图标、Variant 和 surface。
- [x] 加载时隔离未知主题、未来版本和缺失迁移。
- [x] 保存时再次验证正常选择和隔离选择。
- [x] 未知或未来主题必须保留原始数据，同时 UI 使用默认主题。
- [x] 用户主动选择其他主题时才允许替换隔离数据。
- [x] 正常主题选择违规时阻止保存并显示可理解错误。
- [x] 隔离数据违规时丢弃并记录 warning，不能卡死整个面板配置保存。

## 7. 默认主题与旧配置适配

- [x] 实现 `core.default`，视觉上尽量保持当前默认风格。
- [x] 把现有外观字段映射为 `core.default` 配置或 Token overrides。
- [x] 旧配置没有 `theme` 时自动生成默认 ThemeSelection。
- [x] 保留旧字段供旧客户端读取，不立即删除。
- [x] 新配置保存期间同步维护必要的旧字段，保证滚动升级兼容。
- [x] 明确兼容字段的弃用计划，但本阶段不移除。
- [x] 增加旧配置 → 新主题选择的测试样本。

## 8. Web 与 Extension 存储隔离

- [x] Web 将主题选择保存到 `panelConfig.theme`。
- [x] Web 通过现有 `expectedRevision` mutation 同步。
- [x] Extension 将主题选择保存到 `EXTENSION_APPEARANCE_KEY`。
- [x] Extension 不读取或回写 Web 的 `panelConfig.theme`。
- [x] ThemeDefinition、Registry、Token 和迁移逻辑双端共享。
- [x] 当前主题选择、配置、壁纸、图标包和 overrides 双端分别保存。
- [x] Extension 保存前做序列化字节比对，相同内容不重复写入。
- [x] 外部标签页变化只应用一次，避免 storage onChanged 回声链。
- [x] 损坏的 Extension 本地主题配置回退默认主题并安全清理。
- [x] Web 离线 mutation 排队时不得提前销毁仍可能恢复的主题数据。

## 9. 服务端 Theme Wire Contract

- [x] 在 Go 服务端为 `panelConfig.theme` 增加无状态结构校验。
- [x] 校验 schemaVersion、themeId、themeVersion、mode、config、overrides 和 iconPackId。
- [x] themeVersion 必须限制到 JavaScript 最大安全整数。
- [x] 固定单主题配置、overrides 和整个主题信封大小上限。
- [x] 前端与 Go 使用相同 ID 正则和字段可选规则。
- [x] 定义统一 JSON 字节计算口径。
- [x] 特别覆盖 Go `json.Marshal` 与 `JSON.stringify` 对 `<`、`>`、`&`、U+2028、U+2029 的差异。
- [x] 不允许一条无效主题配置导致其他无关 panel 字段被静默写入。
- [x] 参数错误返回明确错误，不返回内部堆栈或实现细节。

## 10. 小组件主题适配

- [x] `WidgetHost` 外壳使用 Widget Token。
- [x] Widget 加载态、错误态和重试按钮使用主题变量。
- [x] 在 WidgetContext 中提供主题 ID、实际模式和只读 Widget Token。
- [x] 内置 Clock、Date、Search、Weather、Trending、Countdown 使用 CSS Variables。
- [x] 图表或趋势颜色使用 `widget.chartColors`。
- [x] 内置 Widget 清理不必要的硬编码浅色/深色值。
- [x] 第三方 Widget 未主动适配时，外壳仍保持主题一致。
- [x] Widget 独立预览没有 ThemeProvider 时回退默认主题。
- [x] 编辑态、隐藏态和响应式布局不受主题切换破坏。
- [x] 更新 Widget 开发文档，增加主题适配 Checklist。

## 11. 书签与组件 UI Token 化

- [x] 书签卡片背景、边框、阴影、文字和图标容器使用 Bookmark Token。
- [x] 分组功能区和当前分组状态使用 Sidebar Token。
- [x] 搜索框使用稳定主题变量。
- [ ] 个人中心、设置页和管理弹窗使用 Modal Token。
- [ ] Notification、Message、Confirm 和错误提示使用主题状态色。
- [ ] 浅色主题下检查文字对比度和大片白屏问题。
- [ ] 深色主题下检查透明层、模糊层和弹窗边界。
- [x] 移动端和窄屏下主题变量不能造成溢出。
- [x] 第三方主题不得依赖项目内部 DOM 层级或 `nth-child` 选择器。

## 12. 语义图标与图标包

- [x] 定义 `ThemeIconName` 语义名称集合。
- [x] 定义 `ThemeIconSet`。
- [x] 实现 `ThemeIcon`，只接受语义名称。
- [x] 实现缺失图标回退到默认图标包。
- [x] 系统功能图标逐步从硬编码 Iconify 名称迁移到 `ThemeIcon`。
- [x] 单色 SVG/Iconify 图标使用 `currentColor`。
- [x] 用户上传图片、favicon、网站 Logo 保持原始颜色。
- [x] 禁止主题强制给用户图片套单色滤镜。
- [x] 允许用户单独覆盖主题默认图标包。
- [x] 图标包选择在 Web 与 Extension 分别保存。
- [x] 图标资源必须本地打包，禁止远程脚本。
- [x] SVG 必须拒绝脚本、事件属性和外部执行资源。

## 13. Variant 规范

- [x] 定义 Bookmark Variant：glass、solid、minimal。
- [x] 定义 Widget Variant：glass、solid、borderless。
- [x] 定义 Sidebar Variant：floating、attached、minimal。
- [x] 定义 Search Variant：pill、box、underline。
- [x] Variant 只选择项目内置稳定结构，不允许注入任意 HTML。
- [x] 主题可声明默认 Variant，用户可单独覆盖。
- [x] 未知 Variant 自动回退默认值。
- [x] Variant 变更不得改变业务数据或书签同步结构。

## 14. 主题设置与预览 UI

- [x] 新增主题中心入口。
- [ ] 展示主题预览图、名称、作者、版本和说明。
- [x] 展示 Web/Extension surface 兼容标识。
- [x] 支持 light、dark、auto 模式。
- [x] 根据 Config Schema 自动生成设置表单。
- [x] label 和 description 均支持 i18n key 与字面回退。
- [x] 支持选择图标包。
- [x] 支持选择书签、Widget、Sidebar、Search Variant。
- [x] 支持实时预览但不立即持久化。
- [x] 取消预览恢复原主题和原配置。
- [x] 确认时先校验，再原子保存。
- [x] 保存成功更新 Last Known Good。
- [x] 保存失败恢复 Last Known Good 并显示错误。
- [x] 支持一键恢复 `core.default`。
- [x] 不允许设置弹窗在 Extension 主题下出现大片白色背景。

## 15. 数据化安全主题包

- [ ] 设计 `theme-package.zip` 格式。
- [ ] 主题包包含 `theme.json`、preview 和本地 assets/icons。
- [x] `theme.json` 只允许 Token、配置描述、Variant、图标映射和资源清单。
- [x] 禁止 JavaScript、Vue、HTML、远程脚本和任意 CSS 选择器。
- [x] 禁止路径穿越、绝对路径和符号链接。
- [x] ZIP 总大小建议不超过 10 MiB。
- [x] 单资源建议不超过 2 MiB。
- [x] 预览图建议不超过 1 MiB。
- [x] 总资源数建议不超过 100。
- [x] 图片、字体和 SVG 使用 MIME 白名单。
- [x] URL 仅允许安全本地资源引用或明确允许的 HTTP(S) 页面链接。
- [x] 导入前完整验证，失败时不写入部分状态。
- [x] 导入成功后生成 SHA-256 摘要。
- [x] 当前阶段不实现主题商店和远程自动更新。

## 16. 可信源码主题

- [x] 提供 `defineTheme()` 类型安全入口。
- [x] 提供第三方源码主题示例。
- [ ] `component`（背景渲染 Slot）是【保留且未实现】的 @deprecated 预留字段：ThemeProvider 不渲染它、外部数据主题包被丢弃、源码主题不得依赖/执行它。启用前必须先实现「受控渲染入口 + 错误边界」。
- [x] 明确源码主题拥有应用代码权限，不能作为普通用户上传包执行。
- [x] 不允许源码主题绕过 Runtime、Storage 和安全导航接口。
- [x] 更新贡献指南，说明 `core.` 保留、命名、版本和迁移规则。

## 17. 共享契约样本与自动测试

- [x] 新增 `scripts/fixtures/theme-wire-samples.json`。
- [x] TS 和 Go 消费完全相同的结构样本。
- [x] 覆盖合法默认主题选择。
- [x] 覆盖未知但结构合法的未来主题。
- [x] 覆盖非法 ID、非法 mode 和非法版本。
- [x] 覆盖大于 JavaScript 安全整数的版本。
- [x] 覆盖 config、overrides 和总信封大小边界。
- [x] 覆盖 `<>&`、U+2028、U+2029 JSON 字节边界。
- [x] 覆盖危险 URL 和危险资源路径。
- [x] 覆盖重复资产路径和重复语义图标。
- [x] 覆盖未知字段和字段类型错误。
- [x] 增加 `scripts/validate-theme-registry.mjs`。
- [x] 测试注册、重复 ID、默认配置和 Token 完整性。
- [x] 测试连续迁移和缺失迁移隔离。
- [x] 测试未知主题不丢失且 UI 回退默认主题。
- [x] 测试序列化出口保证可通过 Go 校验。
- [x] 测试 ThemeProvider 原子应用与默认回退。
- [x] 测试预览取消、保存失败回滚和 Last Known Good。
- [x] 测试 Web 与 Extension 主题选择互不覆盖。
- [x] 测试 Extension 相同序列化内容不重复写入。
- [x] 测试 ThemeIcon 缺失回退。
- [x] 测试用户图片不被染色。
- [x] 测试 WidgetContext 主题注入和无 Provider 回退。

## 18. 文档

- [x] 新增 `doc/theme-development.md`。
- [x] 说明主题定义、Token、配置 Schema、迁移和 surface。
- [x] 说明 Widget 如何使用主题 Token。
- [x] 说明语义图标和用户图片边界。
- [x] 提供完整第三方主题示例。
- [x] 提供安全主题包结构示例。
- [x] 明确运行时安全主题不能执行代码。
- [x] 明确可信源码主题必须经过审核。
- [x] 更新 `doc/web_extension_architecture.md` 的主题存储边界。
- [x] 更新 Widget 开发文档的主题适配要求。

## 18.5. Extension 入口 chunk 体积分析（非阻塞，仅分析与 TODO）

**测量（本阶段实测，`vite build --mode extension --config vite.config.analyze.mts` 生成 sourcemap + 未压缩产物）：**
- 入口 chunk 为 `store-*.js`，压缩后 **796,244 B**，未压缩 **1,783,480 B**，触发 Vite/Rolldown 的 500 KB 警告。
- 未压缩（由 `.map` 的 `sources`/`sourcesContent` 统计，字节为模块源码长度）：vue-router ≈57.5 KB、@iconify/vue ≈50.7 KB、pinia ≈50.3 KB、naive-ui `Input` ≈41.9 KB、`DatePicker` ≈34.3 KB、`Select` ≈30.4 KB、crypto-js `cipher-core` ≈29.9 KB、`TimePicker` ≈29.9 KB、date-fns `parse` ≈29.1 KB；src 侧最大为 `themes/registry.ts` ≈18.4 KB、`themes/ThemeSettingsModal.vue` ≈15.2 KB、`widgets/registry.ts` ≈13.6 KB、`themes/cssVariables.ts` ≈10.2 KB。

**根因：**
- `src/themes/index.ts`（桶文件）**静态 re-export** 三个 `.vue` SFC：`ThemeProvider.vue`、`ThemeIcon.vue`、`ThemeSettingsModal.vue`（第 65-67 行）。
- `src/App.vue`（静态入口）`import { ThemeProvider, registerThemeStoreAccessor } from '@/themes'`；`src/store/modules/panel/index.ts`（静态入口）`import { preparePanelAppearance } from '@/themes'`。二者都触发桶文件求值。
- 其中 `ThemeSettingsModal.vue` 静态 `import` 了大量 naive-ui（`NDatePicker`、`NTimePicker`、`NColorPicker`、`NInputNumber`、`NSelect`、`NModal`、`NPopconfirm`、`NSwitch`、`NSlider`、`NSpace`、`useMessage` 等），连带把 naive-ui 的 `Popover`、`Scrollbar`、`SelectMenu`、`Selection`、`Tag`、`Modal`、`BodyWrapper`、`VirtualList` 以及 `date-fns` / `date-fns-tz` 一并带入入口 chunk。这正是上面「naive-ui 模块 + crypto-js + date-fns」清单的来源。
- Widget 本身是懒加载的（`WidgetHost` 通过 `definition.load()` 动态 `import`），因此 widget 组件不占入口；但 `src/widgets/registry.ts` 作为注册表被静态引用而留在入口。

**可实施的分割方案（按风险从低到高；未实施，仅记录）：**
1. 把 `ThemeSettingsModal` 从 `@/themes` 桶文件去掉（删除 `src/themes/index.ts` 第 67 行 re-export），改由其真实消费者直接从文件路径导入：`src/views/home/index.vue`（第 29 行）与 `src/views/extension/components/UserHubModal.vue`（第 14 行）。这样 naive-ui 只会出现在懒加载的 `UserHubModal` chunk（Extension 已分割）与 Web 的 `home` chunk，入口 chunk 即脱离 naive-ui。
2. 收窄 store 的桶导入：`src/store/modules/panel/index.ts` 改为 `import { preparePanelAppearance } from '@/themes/legacyAdapter'`、类型从 `@/themes/types` 导入，让 store（静态在入口）不依赖桶文件剩下的 SFC re-export。App.vue 仍从桶文件取 `ThemeProvider`，或同样改为直接文件导入。
3. 对仅管理后台且在首屏不需要的界面（`SystemMonitor/Edit` 弹窗、`SearchBox`、`Users` / `UserInfo` / `UserSessions` / `BackupRestore` 等 app）改用 `defineAsyncComponent` 懒加载。
4. 用带 sourcemap 的 analyze 构建复测入口 chunk 落地阈值；**不要**改 `chunkSizeWarningLimit`，也**不要**加 `manualChunks`（本阶段无需手工配置分包即可释出 chunk）。

**明确结论：** 本节为分析与 TODO 记录，**优化未实施**；`chunkSizeWarningLimit` 未改动，未新增 `manualChunks`，未声称已完成优化。上述分析不影响本任务任何已验证的修复与版本号。

## 19. 全量验证

- [x] 运行 Theme Registry 专项验证。
- [x] 运行 Widget Registry 专项验证，确保没有回归。
- [x] 运行 TypeScript 类型检查。
- [x] 运行全量 ESLint。
- [x] 运行全部既有架构验证脚本。
- [x] 运行完整 Go 测试。
- [x] 构建 Web 生产版本。
- [x] 构建 Extension 生产版本。
- [x] 验证 Manifest V3。
- [x] 检查 Web 与 Extension 的主题选择不会互相覆盖。
- [ ] 手动验证默认、浅色、深色和损坏主题回退。
- [ ] 手动验证首页、个人中心、弹窗、通知、书签和 Widget 外壳。
- [ ] 检查窄屏、移动端、高 DPI 和系统主题变化。
- [x] 运行 `git diff --check`。
- [x] 确认没有意外提交构建缓存、临时文件或第三方主题测试包。

## 20. 版本和最终安装包

- [x] 所有修改和测试完成前保持版本 0.0.6。
- [x] 最终准备打包时使用现有版本脚本递增一次补丁号到 0.0.7。
- [x] 确认 `service/assets/version`、`package.json` 和 `extension/manifest.json` 三源一致。
- [x] 重新构建 Extension。
- [x] 生成 `artifacts/panel-next-extension-v0.0.7.zip`。
- [x] 生成同名 `.sha256`。
- [x] 使用 `unzip -t` 验证 ZIP 完整性。
- [x] 使用 `sha256sum -c` 验证校验文件。

## 21. 完成定义

- [x] 第三方只注册 `ThemeDefinition` 即可出现在主题中心，无需修改首页代码。
- [x] Web 首页和 Extension 首页都由同一 Theme SDK 渲染。
- [x] Web 与 Extension 的主题选择和配置分别保存、互不覆盖。
- [x] 首页、个人中心、设置、通知、弹窗、书签和 Widget 外壳都能跟随主题。
- [x] 内置 Widget 内部能使用 Widget Token。
- [x] 系统功能图标可整套替换且缺失时安全回退。
- [x] 用户上传图片、favicon 和网站 Logo 不被错误染色。
- [x] 未知或未来主题不会丢失数据，也不会卡死面板保存。
- [x] 无效主题和资源无法造成白屏或执行任意代码。
- [x] 主题预览可取消，保存失败可回滚。
- [x] 所有自动测试、Go 测试和双端生产构建通过。
- [x] 最终报告包含：修改范围、兼容策略、安全边界、测试结果、剩余限制和安装包路径。
