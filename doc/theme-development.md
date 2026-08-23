# Panel Next 主题开发指南

> 适用版本：Theme SDK v1（主题选择信封 `schemaVersion: 1`）
>
> 本文面向第三方主题作者与内置主题维护者，说明主题定义、Token、配置 Schema、迁移、surface 边界、语义图标、Variant 规范与数据化主题包的安全要求。

## 1. 核心概念

| 概念 | 说明 |
| --- | --- |
| ThemeDefinition | 一个主题的全部声明：ID、版本、元信息、Token、图标、Variant、配置 Schema |
| ThemeSelection | 用户对主题的选择信封（含模式、配置、覆盖、图标包），双端分别保存 |
| Token | 受控的设计变量（颜色/字体/圆角/间距/效果等），解析后输出为 `--pn-*` CSS 变量 |
| Variant | 组件形态预设（如书签卡片 glass/solid/minimal），只切换项目内置结构 |
| surface | 运行端：`web` 或 `extension`；未声明表示双端可用 |

安全边界：运行时主题**只能声明数据**。禁止 JavaScript、Vue、HTML、远程脚本和任意 CSS 选择器进入主题系统；可信源码主题的代码必须随应用一起打包并经过审核。

## 2. 主题 ID 与版本

- ID 规则：小写字母或数字开头，仅小写字母、数字、点、连字符，1~64 字符；
- 推荐使用 `<vendor>.<name>` 命名空间（如 `acme.night`）；
- `core.` 前缀保留给内置主题（当前仅 `core.default`），第三方注册会被拒绝；
- `version` 必须为 ≥1 的 JavaScript 安全整数（≤ 2^53−1）；
- 重复 ID 注册直接抛错。

## 3. 最小主题示例

```ts
import { defineTheme } from '@/themes'

export default defineTheme({
  id: 'acme.sunrise',
  version: 1,
  meta: {
    name: 'Acme Sunrise',
    description: 'theme.acmeSunrise.description', // 支持 i18n key 或字面文案
    author: 'Acme',
    homepage: 'https://example.com/sunrise',
  },
  surfaces: ['web', 'extension'], // 缺省表示双端可用
  tokens: {
    light: {
      color: { accent: '#f97316' },
      radius: { large: '20px' },
    },
    dark: {
      color: { accent: '#fb923c' },
      bookmark: { cardBackground: 'rgba(30,41,59,0.9)' },
    },
  },
  variants: { bookmark: 'solid', search: 'box' }, // 声明默认 Variant
  icons: { settings: 'acme-gear' },               // 只允许覆盖受支持的语义图标
  configSchema,                                    // 与 Widget 共享的字段构造器（见 §5）
  defaultConfig: () => ({ density: 'cozy' }),
})
```

注册后主题自动出现在主题中心（Web 首页工具栏 / 扩展个人中心），无需修改首页代码：

```ts
import { themeRegistry } from '@/themes'
themeRegistry.register(myTheme)
```

## 4. 完整 Token 集

`core.default` 提供全部 Token；第三方主题允许部分覆盖，解析结果始终用默认集深度补齐。所有值经过严格解析（颜色/长度/时长/字重/阴影白名单语法），非法值会在注册期抛错、在加载期触发隔离回退，不会拼入任意 CSS。

| 分组 | 键 |
| --- | --- |
| color | pageBackground, surface, surfaceOverlay, surfaceHover, mask, border, textPrimary, textSecondary, textMuted, accent, success, warning, danger |
| font | family, weightHeading, weightBody |
| radius | small, medium, large, round |
| spacing | compact, normal, relaxed |
| effect | blur, shadowLow, shadowMedium, shadowHigh, durationFast, durationNormal, durationSlow |
| bookmark | cardBackground, cardBorder, cardShadow, titleColor, descriptionColor, iconBackground, iconRadius |
| widget | background, border, shadow, textColor, mutedText, loadingColor, errorColor, errorBorder, retryBackground, retryBorder, chartColors(≤8) |
| sidebar | background, border, hoverBackground, activeBackground, textColor, activeTextColor |
| modal | background, overlay, border, titleTextColor, contentTextColor |
| notification | background, titleTextColor, contentTextColor, successColor, warningColor, errorColor, boxShadow |
| icon | defaultColor, activeColor |

CSS 变量命名规则：分组 + 驼峰转 kebab，统一 `--pn-` 前缀，例如 `color.pageBackground → --pn-color-page-background`；图表色板额外展开为 `--pn-widget-chart-color-0..7` 单值变量。变量只应用到 Panel Next 根容器（`.pn-theme-root`），不污染宿主页面。

## 5. 配置 Schema

主题配置 Schema 与小组件共享同一套字段构造器（`@/sdk/configSchema`）：`string / boolean / integer / number / enumeration / isoDate / url / color`。主题中心根据 `fields` 描述符自动生成设置表单；`label/description` 支持 i18n key 与字面回退。

```ts
import { defineConfigSchema, color, enumeration } from '@/sdk/configSchema'

const configSchema = defineConfigSchema({
  density: enumeration({ values: ['compact', 'cozy', 'relaxed'], default: 'cozy', label: 'theme.density' }),
  highlight: color({ default: '#10b981' }),
})
```

解析语义：多余字段剥离、缺失字段填默认值、类型不符抛错并由宿主隔离违规数据。

## 6. 版本迁移

用户保存的选择携带写入时的 `themeVersion`。升级主题结构时提供连续迁移：

```ts
migrations: {
  1: config => ({ ...config, density: config.compact ? 'compact' : 'cozy' }),
}
```

规则：
- 从旧版本逐步执行到当前版本，任何缺失步骤都会导致该选择进入**隔离区**；
- 隔离时保留原始数据（未来版本/未知主题同样保留），UI 回退 `core.default` 渲染；
- 用户主动切换其他主题时才会替换隔离数据，面板其余配置保存不受影响。

## 7. Web 与 Extension 存储边界

产品边界：分组和书签双端共享；样式、主题、组件布局双端分别保存。

- Web：主题选择保存在 `panelConfig.theme`，通过现有 `expectedRevision` mutation（`userConfig/set`）同步服务端；
- Extension：保存在 `EXTENSION_APPEARANCE_KEY` 本地载荷中，**不读取也不回写** Web 的服务端 `panelConfig.theme`；
- 双端共享 ThemeDefinition、Registry、Token 与迁移逻辑；选择/配置/壁纸/图标包/overrides 各自独立；
- 服务端对 `panelConfig.theme` 执行与前端一致的无状态校验（见 `service/api/api_v1/panel/themeValidation.go` 与共享样本 `scripts/fixtures/theme-wire-samples.json`）；
- 保存流程为原子事务：先序列化校验并构造目标快照，服务端确认（Web）或本地写入成功
  （Extension）后才提交 Store；失败时 Store 保持原值，清除预览即恢复原主题。

启动迁移：视图挂载时调用 `ensureThemeSelection(config, mode)` 为缺少 theme 的旧配置补
默认选择（含 iconTextColor 映射）；Extension 端在应用本地外观前先以 `stripInvalidTheme`
剥离结构损坏的主题选择。

## 8. 语义图标与用户图片

- 系统功能图标通过语义名引用：`<ThemeIcon name="settings" />`；图标包把语义名映射到本地打包 SVG 资源；
- 缺失语义图标自动回退默认图标包；单色 SVG 使用 `currentColor`；
- **用户上传图片、favicon、网站 Logo 保持原始颜色**，主题不得对其套单色滤镜；
- 图标资源必须本地打包，禁止远程脚本；SVG 拒绝脚本、事件属性和外部执行资源；
- 用户选择独立图标包（`selection.iconPackId`）时，该包覆盖主题声明的同名语义图标，
  未覆盖键依次回退主题声明与默认包；图标包经 `registry.registerIconPack()` 注册后
  出现在主题中心可选列表。选择随主题双端分别保存。

## 9. Variant 规范

| 区域 | 取值 |
| --- | --- |
| 书签卡片 bookmark | glass / solid / minimal |
| 小组件 widget | glass / solid / borderless |
| 侧边栏 sidebar | floating / attached / minimal |
| 搜索框 search | pill / box / underline |

Variant 只切换项目内置稳定结构，不允许注入任意 HTML；主题声明默认值，用户可在主题中心单独覆盖；未知取值自动回退默认；变更不影响业务数据与书签同步结构。

## 10. 数据化安全主题包

主题包是纯数据分发格式（清单 + 本地资源），当前阶段无商店与远程自动更新：

```
theme-package (v1)
├─ theme.json        # format: "panel-next-theme-package", formatVersion: 1
├─ preview.png       # ≤ 1 MiB
└─ assets/*          # 图片/字体/SVG，MIME 白名单，单文件 ≤ 2 MiB，总数 ≤ 100，总量 ≤ 10 MiB
```

`theme.json` 只允许 Token、配置默认值、Variant、图标映射和资源清单。导入前完整校验：

- 禁止 JavaScript/Vue/HTML/远程脚本/任意 CSS 选择器；
- 路径禁止穿越（`..`）、绝对路径、反斜杠与盘符；
- SVG 内容拒绝 `<script`、`onload=`、`onerror=`、`javascript:` 链接；
- 校验失败不得写入任何状态；成功导入生成 SHA-256 摘要（`computePackageDigest`）。

相关 API：`validateThemePackage` / `themePackageToDefinition` / `isSafeAssetPath`（`src/themes/themePackage.ts`）。

## 11. 可信源码主题

`defineTheme()` 是类型安全入口。源码主题拥有应用代码权限，**不能作为普通用户上传包执行**，必须随应用一起打包并经审核；不允许绕过 Runtime、Storage 和安全导航接口。可选高级能力（需审核）：

- `resolveTokens(config, mode)`：根据配置动态派生 Token 覆盖；
- `component`：**【保留且未实现】的 @deprecated 预留字段**。ThemeProvider 不渲染它，外部数据主题包会被丢弃，源码主题也不得依赖/执行它——不要把它当作已支持能力。若启用必须先实现「受控渲染入口 + 错误边界」。

> 数据化主题包一律禁止这两类字段：`resolveTokens` 与 `component` 都会被剥离/拒绝。

贡献约定：`core.` 前缀保留、ID 命名空间、版本递增、迁移连续性要求同本文 §2/§6。

## 12. 开发清单（Checklist）

- [ ] ID 符合正则且未占用 `core.` 前缀；version ≥ 1 安全整数
- [ ] `meta.name` 非空；homepage 为 HTTP(S) 链接
- [ ] light/dark Token 覆盖均能通过严格值解析（颜色/长度/阴影白名单）
- [ ] 配置 Schema 字段均有 label 或字面文案；defaultConfig 能通过自身 Schema
- [ ] 结构变更提供连续 migrations
- [ ] surfaces 正确声明；双端主题选择互不影响已验证
- [ ] 语义图标映射均为本地资源；未触碰用户图片颜色
- [ ] Variant 仅使用内置取值
- [ ] 通过 `pnpm validate:theme-registry`、`pnpm type-check`、`pnpm lint`

## 13. 已知迁移清单（硬编码样式 → Token 化进度）

以下为本阶段完成的 Token 化点位及遗留项，作为后续迭代依据：

已完成（带原视觉回退值）：
- WidgetHost 加载态/错误态/重试按钮 → `--pn-widget-*`
- 内置 Trending/Weather/Countdown 卡片外壳与文字 → `--pn-widget-*`、`--pn-notification-warning-color`
- SearchBox 默认背景/文字色/边框 → `--pn-widget-*`
- 首页状态栏胶囊、Widget 工具栏按钮 → `--pn-sidebar-*` / `--pn-widget-*` / `--pn-radius-round`
- Extension 分组容器（item-list）与搜索框强化样式 → `--pn-bookmark-*` / `--pn-widget-*`
- AppIcon 书签卡片圆角/悬停阴影 → `--pn-radius-large` / `--pn-bookmark-*`

遗留（后续版本处理）：
- naive-ui 弹窗/通知内部配色仍走 GlobalThemeOverrides（扩展为静态暗色表）；可后续从 Modal/Notification Token 动态生成
- 首页 logo/clock 文字阴影仍为固定黑色 text-shadow
- SystemMonitor 卡片内部仍有少量固定透明度
- ItemCard（AppStarter 内）边框尚未接入 Bookmark Token
