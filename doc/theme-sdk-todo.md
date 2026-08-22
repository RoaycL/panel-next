# Panel Next Theme SDK 实施 TODO

> 状态：待实施
>
> 编写日期：2026-08-22
>
> 当前测试版本：0.0.6
>
> 目标：建立规范化、可供第三方开发、支持 Web 与 Chrome Extension、可驱动小组件和系统图标的 Theme SDK。

## 0. 执行约束

- [ ] 开始前完整阅读本文件，不跳过安全、兼容和验收章节。
- [ ] 检查当前工作区状态，保留所有已有未提交修改，不覆盖无关变更。
- [ ] 完整检查现有主题、样式、扩展外观、Widget、图标、弹窗和个人中心代码。
- [ ] 所有源文件修改使用 `apply_patch`，不使用脚本直接覆写源文件。
- [ ] 不删除现有旧样式字段，先提供兼容适配器。
- [ ] 不改变“分组和书签双端共享，样式、主题、组件布局双端分别保存”的产品边界。
- [ ] 不实现运行时远程 JavaScript、任意 HTML、Vue 代码或远程脚本主题。
- [ ] 普通测试和构建不修改版本号。
- [ ] 只有全部测试通过并准备最终安装包时，才按测试版策略将 0.0.6 递增到 0.0.7。
- [ ] 实施中如果发现本文件设计与现有架构冲突，先记录证据并采用兼容性最强的实现。

## 1. 现状审计

- [ ] 查找所有直接读取 `panelConfig` 外观字段的页面和组件。
- [ ] 查找所有硬编码颜色、圆角、阴影、模糊和动画时间。
- [ ] 查找系统功能图标中硬编码的 Iconify/SVG 名称。
- [ ] 区分系统语义图标、用户上传图片、favicon 和网站 Logo。
- [ ] 检查 Web 首页、Extension 首页、个人中心、通知、确认框、设置弹窗和 Widget 外壳。
- [ ] 列出现有字段：`backgroundImageSrc`、`backgroundBlur`、`backgroundMaskNumber`、`iconStyle`、`iconTextColor` 等。
- [ ] 确认 Extension 外观仍通过 `EXTENSION_APPEARANCE_KEY` 本地保存。
- [ ] 确认 Web 外观仍通过 `panelConfig` 和 `userConfig/set` 同步。
- [ ] 输出一份硬编码样式迁移清单，作为后续 Token 化依据。

## 2. 建立目录与公共 Schema

- [ ] 新增 `src/themes/types.ts`。
- [ ] 新增 `src/themes/constants.ts`。
- [ ] 新增 `src/themes/schema.ts`。
- [ ] 新增 `src/themes/registry.ts`。
- [ ] 新增 `src/themes/runtime.ts`。
- [ ] 新增 `src/themes/cssVariables.ts`。
- [ ] 新增 `src/themes/ThemeProvider.vue`。
- [ ] 新增 `src/themes/ThemeSettingsModal.vue`。
- [ ] 新增 `src/themes/ThemeIcon.vue`。
- [ ] 新增 `src/themes/builtins/default.ts` 和入口文件。
- [ ] 新增 `src/themes/index.ts`，只导出稳定公共 API。
- [ ] 评估是否将 Widget 配置 Schema 提取到 `src/sdk/configSchema.ts`。
- [ ] 如果提取公共 Schema，保留现有 Widget 导出路径的兼容 re-export。
- [ ] 公共 Schema 错误信息不得继续写死为 “widget config”。

## 3. 定义主题契约

- [ ] 定义 `ThemeDefinition<TConfig>`。
- [ ] 定义 `ThemeMeta`，包含名称、描述、作者、主页和预览图。
- [ ] 定义 `ThemeSurface = 'web' | 'extension'`。
- [ ] 定义 `ThemeMode = 'light' | 'dark' | 'auto'`。
- [ ] 定义 `ThemeContext`，包含 surface、实际明暗模式和运行环境信息。
- [ ] 定义 `ThemeSelection` v1 信封。
- [ ] 定义 `ThemeLoadResult`、隔离数据和可读问题列表。
- [ ] 定义 `ThemeMigration` 连续迁移契约。
- [ ] 固定主题 ID 规则为小写、最多 64 字符，推荐 `<vendor>.<name>`。
- [ ] 保留 `core.` 前缀给内置主题。
- [ ] 要求版本为大于等于 1 的 JavaScript 安全整数。
- [ ] 重复主题 ID 注册必须抛错。
- [ ] `surfaces` 缺省表示 Web 与 Extension 均可使用。

## 4. 定义完整 Theme Token

- [ ] 定义页面背景、普通表面、浮层表面、悬停表面、遮罩和边框颜色。
- [ ] 定义主文字、次级文字、弱化文字和强调色。
- [ ] 定义 success、warning、danger 状态色。
- [ ] 定义字体族、标题字重和正文字重。
- [ ] 定义 small、medium、large、round 圆角。
- [ ] 定义 compact、normal、relaxed 间距。
- [ ] 定义 blur、三级 shadow 和动画时长。
- [ ] 定义 Bookmark 专用 Token。
- [ ] 定义 Widget 专用 Token，包括加载、错误和图表色板。
- [ ] 定义 Sidebar 专用 Token。
- [ ] 定义 Modal/Notification 专用 Token。
- [ ] 定义 Icon 专用 Token。
- [ ] 默认主题必须完整提供所有 Token。
- [ ] 第三方主题允许提供部分覆盖，但解析结果必须用默认 Token 深度补齐。
- [ ] Token 对象对组件只读，避免组件运行时修改全局主题。
- [ ] 对颜色、长度、数字、字体和阴影值进行严格解析，不直接拼接任意 CSS。

## 5. CSS Variables 与 ThemeProvider

- [ ] 实现稳定 Token → CSS Variable 映射。
- [ ] CSS 变量统一使用 `--pn-` 前缀。
- [ ] `ThemeProvider` 只把变量应用到 Panel Next 根容器，避免污染宿主页面。
- [ ] 实现实际明暗模式解析，`auto` 跟随系统并响应变化。
- [ ] 实现主题切换时的批量原子更新，避免逐变量闪烁。
- [ ] 实现 `useTheme()`。
- [ ] 实现 `useWidgetTheme()`。
- [ ] 主题上下文缺失时自动回退 `core.default`。
- [ ] 页面首次渲染前尽可能应用可信主题快照，减少主题闪烁。
- [ ] 主题解析或应用异常时捕获错误并回退默认主题，禁止白屏。

## 6. ThemeRegistry

- [ ] 实现 `register()`。
- [ ] 实现 `get()`。
- [ ] 实现按 surface 过滤的 `list()`。
- [ ] 实现 `createSelection()`。
- [ ] 实现连续版本迁移 `migrate()`。
- [ ] 实现 `loadSelection()`。
- [ ] 实现 `resolve()`，输出完整 Token、图标和 Variant。
- [ ] 实现 `serialize()`。
- [ ] 注册时校验默认配置、Token、图标、Variant 和 surface。
- [ ] 加载时隔离未知主题、未来版本和缺失迁移。
- [ ] 保存时再次验证正常选择和隔离选择。
- [ ] 未知或未来主题必须保留原始数据，同时 UI 使用默认主题。
- [ ] 用户主动选择其他主题时才允许替换隔离数据。
- [ ] 正常主题选择违规时阻止保存并显示可理解错误。
- [ ] 隔离数据违规时丢弃并记录 warning，不能卡死整个面板配置保存。

## 7. 默认主题与旧配置适配

- [ ] 实现 `core.default`，视觉上尽量保持当前默认风格。
- [ ] 把现有外观字段映射为 `core.default` 配置或 Token overrides。
- [ ] 旧配置没有 `theme` 时自动生成默认 ThemeSelection。
- [ ] 保留旧字段供旧客户端读取，不立即删除。
- [ ] 新配置保存期间同步维护必要的旧字段，保证滚动升级兼容。
- [ ] 明确兼容字段的弃用计划，但本阶段不移除。
- [ ] 增加旧配置 → 新主题选择的测试样本。

## 8. Web 与 Extension 存储隔离

- [ ] Web 将主题选择保存到 `panelConfig.theme`。
- [ ] Web 通过现有 `expectedRevision` mutation 同步。
- [ ] Extension 将主题选择保存到 `EXTENSION_APPEARANCE_KEY`。
- [ ] Extension 不读取或回写 Web 的 `panelConfig.theme`。
- [ ] ThemeDefinition、Registry、Token 和迁移逻辑双端共享。
- [ ] 当前主题选择、配置、壁纸、图标包和 overrides 双端分别保存。
- [ ] Extension 保存前做序列化字节比对，相同内容不重复写入。
- [ ] 外部标签页变化只应用一次，避免 storage onChanged 回声链。
- [ ] 损坏的 Extension 本地主题配置回退默认主题并安全清理。
- [ ] Web 离线 mutation 排队时不得提前销毁仍可能恢复的主题数据。

## 9. 服务端 Theme Wire Contract

- [ ] 在 Go 服务端为 `panelConfig.theme` 增加无状态结构校验。
- [ ] 校验 schemaVersion、themeId、themeVersion、mode、config、overrides 和 iconPackId。
- [ ] themeVersion 必须限制到 JavaScript 最大安全整数。
- [ ] 固定单主题配置、overrides 和整个主题信封大小上限。
- [ ] 前端与 Go 使用相同 ID 正则和字段可选规则。
- [ ] 定义统一 JSON 字节计算口径。
- [ ] 特别覆盖 Go `json.Marshal` 与 `JSON.stringify` 对 `<`、`>`、`&`、U+2028、U+2029 的差异。
- [ ] 不允许一条无效主题配置导致其他无关 panel 字段被静默写入。
- [ ] 参数错误返回明确错误，不返回内部堆栈或实现细节。

## 10. 小组件主题适配

- [ ] `WidgetHost` 外壳使用 Widget Token。
- [ ] Widget 加载态、错误态和重试按钮使用主题变量。
- [ ] 在 WidgetContext 中提供主题 ID、实际模式和只读 Widget Token。
- [ ] 内置 Clock、Date、Search、Weather、Trending、Countdown 使用 CSS Variables。
- [ ] 图表或趋势颜色使用 `widget.chartColors`。
- [ ] 内置 Widget 清理不必要的硬编码浅色/深色值。
- [ ] 第三方 Widget 未主动适配时，外壳仍保持主题一致。
- [ ] Widget 独立预览没有 ThemeProvider 时回退默认主题。
- [ ] 编辑态、隐藏态和响应式布局不受主题切换破坏。
- [ ] 更新 Widget 开发文档，增加主题适配 Checklist。

## 11. 书签与组件 UI Token 化

- [ ] 书签卡片背景、边框、阴影、文字和图标容器使用 Bookmark Token。
- [ ] 分组功能区和当前分组状态使用 Sidebar Token。
- [ ] 搜索框使用稳定主题变量。
- [ ] 个人中心、设置页和管理弹窗使用 Modal Token。
- [ ] Notification、Message、Confirm 和错误提示使用主题状态色。
- [ ] 浅色主题下检查文字对比度和大片白屏问题。
- [ ] 深色主题下检查透明层、模糊层和弹窗边界。
- [ ] 移动端和窄屏下主题变量不能造成溢出。
- [ ] 第三方主题不得依赖项目内部 DOM 层级或 `nth-child` 选择器。

## 12. 语义图标与图标包

- [ ] 定义 `ThemeIconName` 语义名称集合。
- [ ] 定义 `ThemeIconSet`。
- [ ] 实现 `ThemeIcon`，只接受语义名称。
- [ ] 实现缺失图标回退到默认图标包。
- [ ] 系统功能图标逐步从硬编码 Iconify 名称迁移到 `ThemeIcon`。
- [ ] 单色 SVG/Iconify 图标使用 `currentColor`。
- [ ] 用户上传图片、favicon、网站 Logo 保持原始颜色。
- [ ] 禁止主题强制给用户图片套单色滤镜。
- [ ] 允许用户单独覆盖主题默认图标包。
- [ ] 图标包选择在 Web 与 Extension 分别保存。
- [ ] 图标资源必须本地打包，禁止远程脚本。
- [ ] SVG 必须拒绝脚本、事件属性和外部执行资源。

## 13. Variant 规范

- [ ] 定义 Bookmark Variant：glass、solid、minimal。
- [ ] 定义 Widget Variant：glass、solid、borderless。
- [ ] 定义 Sidebar Variant：floating、attached、minimal。
- [ ] 定义 Search Variant：pill、box、underline。
- [ ] Variant 只选择项目内置稳定结构，不允许注入任意 HTML。
- [ ] 主题可声明默认 Variant，用户可单独覆盖。
- [ ] 未知 Variant 自动回退默认值。
- [ ] Variant 变更不得改变业务数据或书签同步结构。

## 14. 主题设置与预览 UI

- [ ] 新增主题中心入口。
- [ ] 展示主题预览图、名称、作者、版本和说明。
- [ ] 展示 Web/Extension surface 兼容标识。
- [ ] 支持 light、dark、auto 模式。
- [ ] 根据 Config Schema 自动生成设置表单。
- [ ] label 和 description 均支持 i18n key 与字面回退。
- [ ] 支持选择图标包。
- [ ] 支持选择书签、Widget、Sidebar、Search Variant。
- [ ] 支持实时预览但不立即持久化。
- [ ] 取消预览恢复原主题和原配置。
- [ ] 确认时先校验，再原子保存。
- [ ] 保存成功更新 Last Known Good。
- [ ] 保存失败恢复 Last Known Good 并显示错误。
- [ ] 支持一键恢复 `core.default`。
- [ ] 不允许设置弹窗在 Extension 主题下出现大片白色背景。

## 15. 数据化安全主题包

- [ ] 设计 `theme-package.zip` 格式。
- [ ] 主题包包含 `theme.json`、preview 和本地 assets/icons。
- [ ] `theme.json` 只允许 Token、配置描述、Variant、图标映射和资源清单。
- [ ] 禁止 JavaScript、Vue、HTML、远程脚本和任意 CSS 选择器。
- [ ] 禁止路径穿越、绝对路径和符号链接。
- [ ] ZIP 总大小建议不超过 10 MiB。
- [ ] 单资源建议不超过 2 MiB。
- [ ] 预览图建议不超过 1 MiB。
- [ ] 总资源数建议不超过 100。
- [ ] 图片、字体和 SVG 使用 MIME 白名单。
- [ ] URL 仅允许安全本地资源引用或明确允许的 HTTP(S) 页面链接。
- [ ] 导入前完整验证，失败时不写入部分状态。
- [ ] 导入成功后生成 SHA-256 摘要。
- [ ] 当前阶段不实现主题商店和远程自动更新。

## 16. 可信源码主题

- [ ] 提供 `defineTheme()` 类型安全入口。
- [ ] 提供第三方源码主题示例。
- [ ] 允许经过审核的有限背景渲染器或公开 Slot。
- [ ] 明确源码主题拥有应用代码权限，不能作为普通用户上传包执行。
- [ ] 不允许源码主题绕过 Runtime、Storage 和安全导航接口。
- [ ] 更新贡献指南，说明 `core.` 保留、命名、版本和迁移规则。

## 17. 共享契约样本与自动测试

- [ ] 新增 `scripts/fixtures/theme-wire-samples.json`。
- [ ] TS 和 Go 消费完全相同的结构样本。
- [ ] 覆盖合法默认主题选择。
- [ ] 覆盖未知但结构合法的未来主题。
- [ ] 覆盖非法 ID、非法 mode 和非法版本。
- [ ] 覆盖大于 JavaScript 安全整数的版本。
- [ ] 覆盖 config、overrides 和总信封大小边界。
- [ ] 覆盖 `<>&`、U+2028、U+2029 JSON 字节边界。
- [ ] 覆盖危险 URL 和危险资源路径。
- [ ] 覆盖重复资产路径和重复语义图标。
- [ ] 覆盖未知字段和字段类型错误。
- [ ] 增加 `scripts/validate-theme-registry.mjs`。
- [ ] 测试注册、重复 ID、默认配置和 Token 完整性。
- [ ] 测试连续迁移和缺失迁移隔离。
- [ ] 测试未知主题不丢失且 UI 回退默认主题。
- [ ] 测试序列化出口保证可通过 Go 校验。
- [ ] 测试 ThemeProvider 原子应用与默认回退。
- [ ] 测试预览取消、保存失败回滚和 Last Known Good。
- [ ] 测试 Web 与 Extension 主题选择互不覆盖。
- [ ] 测试 Extension 相同序列化内容不重复写入。
- [ ] 测试 ThemeIcon 缺失回退。
- [ ] 测试用户图片不被染色。
- [ ] 测试 WidgetContext 主题注入和无 Provider 回退。

## 18. 文档

- [ ] 新增 `doc/theme-development.md`。
- [ ] 说明主题定义、Token、配置 Schema、迁移和 surface。
- [ ] 说明 Widget 如何使用主题 Token。
- [ ] 说明语义图标和用户图片边界。
- [ ] 提供完整第三方主题示例。
- [ ] 提供安全主题包结构示例。
- [ ] 明确运行时安全主题不能执行代码。
- [ ] 明确可信源码主题必须经过审核。
- [ ] 更新 `doc/web_extension_architecture.md` 的主题存储边界。
- [ ] 更新 Widget 开发文档的主题适配要求。

## 19. 全量验证

- [ ] 运行 Theme Registry 专项验证。
- [ ] 运行 Widget Registry 专项验证，确保没有回归。
- [ ] 运行 TypeScript 类型检查。
- [ ] 运行全量 ESLint。
- [ ] 运行全部既有架构验证脚本。
- [ ] 运行完整 Go 测试。
- [ ] 构建 Web 生产版本。
- [ ] 构建 Extension 生产版本。
- [ ] 验证 Manifest V3。
- [ ] 检查 Web 与 Extension 的主题选择不会互相覆盖。
- [ ] 手动验证默认、浅色、深色和损坏主题回退。
- [ ] 手动验证首页、个人中心、弹窗、通知、书签和 Widget 外壳。
- [ ] 检查窄屏、移动端、高 DPI 和系统主题变化。
- [ ] 运行 `git diff --check`。
- [ ] 确认没有意外提交构建缓存、临时文件或第三方主题测试包。

## 20. 版本和最终安装包

- [ ] 所有修改和测试完成前保持版本 0.0.6。
- [ ] 最终准备打包时使用现有版本脚本递增一次补丁号到 0.0.7。
- [ ] 确认 `service/assets/version`、`package.json` 和 `extension/manifest.json` 三源一致。
- [ ] 重新构建 Extension。
- [ ] 生成 `artifacts/panel-next-extension-v0.0.7.zip`。
- [ ] 生成同名 `.sha256`。
- [ ] 使用 `unzip -t` 验证 ZIP 完整性。
- [ ] 使用 `sha256sum -c` 验证校验文件。

## 21. 完成定义

- [ ] 第三方只注册 `ThemeDefinition` 即可出现在主题中心，无需修改首页代码。
- [ ] Web 首页和 Extension 首页都由同一 Theme SDK 渲染。
- [ ] Web 与 Extension 的主题选择和配置分别保存、互不覆盖。
- [ ] 首页、个人中心、设置、通知、弹窗、书签和 Widget 外壳都能跟随主题。
- [ ] 内置 Widget 内部能使用 Widget Token。
- [ ] 系统功能图标可整套替换且缺失时安全回退。
- [ ] 用户上传图片、favicon 和网站 Logo 不被错误染色。
- [ ] 未知或未来主题不会丢失数据，也不会卡死面板保存。
- [ ] 无效主题和资源无法造成白屏或执行任意代码。
- [ ] 主题预览可取消，保存失败可回滚。
- [ ] 所有自动测试、Go 测试和双端生产构建通过。
- [ ] 最终报告包含：修改范围、兼容策略、安全边界、测试结果、剩余限制和安装包路径。
