# Panel Next 小组件开发指南

本文档面向贡献者，说明如何基于 Panel Next 的标准化组件接口（Widget SDK）开发并随项目源码构建桌面小组件。当前 SDK 不支持运行时安装远程第三方代码或独立组件包分发。

内置实现参考：`src/widgets/builtins.ts` 与 `src/widgets/builtin/*.vue`。

---

## 1. 架构总览

```
src/widgets/
├── types.ts        # 契约层：WidgetInstance / WidgetDefinition / WidgetLayout
├── constants.ts    # 命名规则：类型标识 / 实例 ID 正则
├── registry.ts     # 注册表：注册 / 创建 / 迁移 / 加载布局（严格校验）
├── schema.ts       # 声明式配置构建器与设置表单元数据
├── define.ts       # defineWidget()：类型安全注册入口
├── context.ts      # 运行时上下文与命名空间存储：useWidgetContext / useWidgetStorage
├── capabilities.ts # 运行时能力授权闸门：hasCapability / assertCapability
├── network.ts      # 统一网络客户端：认证/超时/取消/重试/限流/缓存
├── actions.ts      # 宿主动作：通知/确认/开链接/复制/下载/定位
├── WidgetHost.vue  # 宿主：懒加载 + 上下文注入 + 错误边界
└── builtins.ts     # 内置组件注册示例（core.* 前缀）
```

数据流：**布局配置 → Registry 校验/迁移/隔离 → WidgetHost 懒加载组件 → config 字段以 props 注入组件**。Web 布局随账号同步；扩展布局只保存在扩展本地，两端共享定义和渲染接口但不会互相覆盖样式、组件或布局。

---

## 2. 核心契约

### 2.1 WidgetDefinition —— 一个组件的全部声明

```ts
interface WidgetDefinition<TConfig> {
  type: string                    // 全局唯一，格式 <vendor>.<name>，如 acme.stock
  currentVersion: number          // 配置版本，从 1 开始递增
  configSchema: { parse(v: unknown): TConfig }   // 配置解析器（用 defineConfigSchema 构建）
  defaultConfig: () => TConfig    // 默认配置工厂
  size: {                         // 网格尺寸约束（12 列网格）
    default: { columns: number, rows: number }
    min: { columns: number, rows: number }
    max: { columns: number, rows: number }
  }
  migrations?: Record<number, (config: unknown) => unknown>  // v(n)→v(n+1) 迁移
  load: () => Promise<Component>  // 异步加载组件（自动代码分割）
  meta?: { title: string, description?: string, icon?: string } // 自描述元信息
  capabilities?: readonly ('network' | 'storage' | 'clipboard' | 'geolocation')[] // 能力声明
  surfaces?: readonly ('web' | 'extension')[] // 可选；限制组件出现在哪个宿主
}
```

### 2.2 命名规则

| 项 | 规则 | 示例 |
|---|---|---|
| `type` | `/^[a-z][a-z\d.-]{0,63}$/`，推荐 `<vendor>.<name>` | `acme.stock` |
| 实例 `id` | `/^[a-z\d][\w.-]{0,63}$/i`，用户侧自动生成 | `acme.stock.m8x2k1` |

> `core.` 前缀为官方内置保留。第三方请使用自己的组织前缀避免冲突；重名注册会直接抛错。

### 2.3 布局信封（存储与同步格式）

```jsonc
{
  "schemaVersion": 1,
  "widgets": [{
    "id": "acme.stock.abc123",
    "type": "acme.stock",
    "version": 2,
    "position": { "column": 0, "row": 3 },
    "size": { "columns": 3, "rows": 2 },
    "hidden": false,
    "config": { "symbol": "AAPL" }
  }]
}
```

### 2.4 服务端传输契约（Wire Contract）

后端对每个 widget 实例做无状态结构校验（`service/api/api_v1/panel/widgetLayoutValidation.go`），前端以 `validateWidgetWireInstance()` 保持完全一致的规则，并在三处强制执行：

1. **注册源头**：`register/create/migrate` 保证解析后的 config ≤ 32 KiB、尺寸约束 ≤ 12 列 × 24 行；
2. **加载入口**：`loadLayout` 只把满足传输契约的失败实例放入 `quarantinedWidgets` 隔离区，其余直接丢弃——保证隔离数据永远能被服务端接受；
3. **序列化出口**：`serializeWidgetLayout` 对正常实例违规会**抛错阻断保存**，对隔离实例违规则丢弃并告警。

两端规则由共享样本 `scripts/fixtures/widget-wire-samples.json` 双侧测试锁定（TS: `scripts/validate-widget-registry.mjs`；Go: `widgetLayoutValidation_test.go` 的 `TestWireContractSamples`），任何单端修改导致漂移都会在 CI 校验中失败。

宿主通过 `registry.loadLayout()` 加载：可识别但当前不兼容的未知类型、超前版本和缺失迁移实例会进入 `quarantinedWidgets`，保存时原样带回，避免旧客户端覆盖新组件数据；身份损坏、重复 ID 或超限数据才会丢弃并记录 `issues`。单个配置上限 32 KiB，布局上限 256 KiB、最多 100 个实例。

---

## 3. 快速上手：完整示例

### 第 1 步 — 定义配置 Schema

```ts
// src/widgets/contrib/acme-stock.ts
import * as field from '@/widgets/schema'
import { defineConfigSchema } from '@/widgets/schema'
import { defineWidget } from '@/widgets'

export interface StockConfig {
  symbol: string
  refreshMinutes: number
  showChart: boolean
}

export const stockSchema = defineConfigSchema<StockConfig>({
  // 缺省时填 default；类型/长度/范围不符抛错
  symbol: field.string({ default: 'AAPL', min: 1, max: 16, pattern: /^[A-Z.\-]{1,16}$/ }),
  refreshMinutes: field.integer({ default: 5, min: 1, max: 60 }),
  showChart: field.boolean(true),
})
```

可用字段构造器：

| 构造器 | 说明 |
|---|---|
| `field.string({ default?, min?, max?, pattern? })` | 无 default 即必填 |
| `field.boolean(default)` | 必有默认值 |
| `field.integer({ default?, min?, max? })` | 安全整数 |
| `field.number({ default?, min?, max? })` | 有限小数 |
| `field.enumeration<T>({ values, default? })` | 字符串枚举 |
| `field.isoDate({ default? })` | `YYYY-MM-DD` 且校验真实日历日期 |
| `field.url({ ...stringOptions })` | 仅 HTTP(S) URL |
| `field.color({ ...stringOptions })` | 安全颜色名或十六进制颜色 |

字段可附带 `label`、`description`，宿主会据此生成统一设置表单。解析语义：顶层传 `null/undefined` 视为空对象（返回全默认值）；未声明字段一律剥离；错误抛出后该实例会被隔离而不是继续执行。

### 第 2 步 — 实现组件 SFC

```vue
<!-- src/widgets/contrib/AcmeStockWidget.vue -->
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StockConfig } from './acme-stock'
import { useWidgetContext, useWidgetStorage } from '@/widgets'

// 配置字段即 props（由 WidgetHost 自动注入），必须给默认值以兼容独立预览
const props = withDefaults(defineProps<StockConfig>(), {
  symbol: 'AAPL',
  refreshMinutes: 5,
  showChart: true,
})

const { t } = useI18n()
const ctx = useWidgetContext()          // 可能为 null（预览态），需降级处理
const storage = ctx ? useWidgetStorage(ctx.instanceId) : null
const lastPrice = ref<number | null>(storage?.read<number>('lastPrice') ?? null)

let timer: number | null = null

async function refresh() {
  if (ctx?.editMode)
    return                              // 编辑态暂停网络轮询
  try {
    const res = await fetch(`https://example.com/api/quote/${props.symbol}`)
    const data = await res.json()
    lastPrice.value = data.price
    await storage?.write('lastPrice', data.price)
  }
  catch {
    // 失败保持上一次数据，展示占位即可
  }
}

watch(() => [props.symbol, props.refreshMinutes] as const, (start) => {
  if (timer)
    window.clearInterval(timer)
  void refresh()
  timer = window.setInterval(refresh, start[1] * 60_000)
}, { immediate: true })

onUnmounted(() => {
  if (timer)
    window.clearInterval(timer)
})
</script>

<template>
  <section class="acme-stock" :aria-label="t('acme.stock.title')">
    <h3>{{ symbol }}</h3>
    <p v-if="lastPrice !== null">{{ lastPrice.toFixed(2) }}</p>
    <p v-else class="placeholder">--</p>
  </section>
</template>

<style scoped>
/* 组件自持样式，根元素铺满单元格 */
.acme-stock { box-sizing: border-box; width: 100%; height: 100%; padding: 14px; border-radius: 16px;
  color: #fff; background: rgb(18 25 39 / 42%); backdrop-filter: blur(14px);
  border: 1px solid rgb(255 255 255 / 16%); }
</style>
```

### 第 3 步 — 注册

```ts
// src/widgets/contrib/index.ts
import AcmeStockWidget from './AcmeStockWidget.vue'
import { stockSchema } from './acme-stock'
import { defineWidget, widgetRegistry } from '@/widgets'

widgetRegistry.register(defineWidget({
  type: 'acme.stock',
  currentVersion: 1,
  configSchema: stockSchema,
  defaultConfig: () => ({ symbol: 'AAPL', refreshMinutes: 5, showChart: true }),
  size: { default: { columns: 3, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 6, rows: 4 } },
  meta: { title: '股票行情', description: '实时股价小组件（示例）' },
  capabilities: ['network', 'storage'],
  surfaces: ['web', 'extension'],
  load: () => Promise.resolve(AcmeStockWidget),
}))
```

最后在应用初始化阶段（如 `main.ts` 引入 `./widgets/contrib`）执行注册。注册后组件自动出现在「添加组件」菜单中，无需修改任何视图代码。

---

## 4. 宿主提供的运行时能力

### 4.1 useWidgetContext()

| 字段 | 类型 | 用途 |
|---|---|---|
| `instanceId` | `string` | 同类型多实例区分；作为私有存储命名空间 |
| `type` | `string` | 当前组件类型 |
| `editMode` | `boolean`（响应式对象属性） | 布局编辑中为 true：应暂停轮询/动画等昂贵操作 |
| `capabilities` | `readonly WidgetCapability[]` | 当前定义声明的能力 |
| `surface` | `'web' \| 'extension'` | 当前渲染宿主 |

脱离宿主（单元测试、Storybook 预览）返回 `null`，务必判空降级。

### 4.2 useWidgetStorage(instanceId)

按实例隔离的键值存储（Web 走 localStorage、扩展端走 storage 适配层），声明 `'storage'` 能力后使用：

```ts
const { read, write, remove } = useWidgetStorage(ctx.instanceId)
const saved = await write('cache', { at: Date.now() }) // 写盘完成后返回；配额不足时 false
```

键最长 64 字符，单值最大 128 KiB，每个实例总量最大 512 KiB；移除已确认保存的组件时宿主会清理其命名空间。

### 4.3 错误边界

组件渲染期抛出的异常会被 `WidgetHost` 捕获并替换为「组件加载异常」占位卡片，不影响其他组件与仪表盘。但请自行捕获异步任务中的错误（定时器、fetch），异步错误不经过 Vue 错误边界。

---

## 5. 配置版本迁移

当且仅当你需要更改已有配置结构时：

```ts
widgetRegistry.register(defineWidget({
  type: 'acme.stock',
  currentVersion: 2,
  configSchema: stockSchemaV2,
  migrations: {
    // 存量 v1 配置升级到 v2
    1: old => ({ ...old, refreshSeconds: (old as any).refreshMinutes * 60 }),
  },
  /* ... */
}))
```

规则：
- `migrations[n]` 将 version=n 配置转为 n+1，链式执行至 `currentVersion`；
- **缺失迁移会导致该实例被隔离并保留原始数据**，发布新版本时仍必须补齐全部中间迁移；
- 迁移输出仍要能通过最新 `configSchema.parse`。

---

## 6. 开发清单（Checklist）

- [ ] `type` 使用自己的 `<vendor>.` 前缀，符合命名正则
- [ ] 所有 props 都有 `withDefaults` 默认值（兼容直接渲染预览）
- [ ] 定时器/事件监听在 `onUnmounted` 清理；请求可中断（AbortController）
- [ ] `editMode` 为 true 时暂停轮询与动画
- [ ] 外部链接使用 `<a target="_blank" rel="noopener noreferrer">`
- [ ] i18n：文案经 `useI18n().t()`，语言包键已补充 zh-CN/en-US
- [ ] 根元素自适应容器（`width:100%`，禁用固定像素宽高）
- [ ] 声明了实际使用的 `capabilities`，未声明的能力不得调用
- [ ] 用 `surfaces` 限制不兼容的宿主；未声明表示双端可用
- [ ] 改配置结构时提供完整 `migrations`
- [ ] 通过 `pnpm validate:widget-registry`

---

## 7. 边界与约束

### 7.1 宿主能力 SDK

| API | 能力要求 | 说明 |
|---|---|---|
| `useWidgetNetwork()` | `network` | `request(url, options)`：相对路径走项目请求层（自动登录态）；绝对 http(s) URL 直连外部且**绝不附带凭据**。内置 15s 超时、传输失败自动重试（≤3 次）、每实例 30 次/分钟限流、GET 可选 TTL 缓存 |
| `useWidgetActions()` | clipboard/geolocation 按方法 | `notify` / `confirm` 无门槛；`copy(text)` 需 `clipboard`；`getPosition()` 需 `geolocation`；`openLink` 经 `runtime.openUrl`；`download(filename, blobOrUrl)` |
| `hasCapability(cap)` | — | 运行时查询，用于 UI 自适应降级 |

### 7.2 能力层是授权闸门，不是沙箱

被构建进项目源码的组件代码天然拥有页面运行时权限；capabilities 的价值是**声明制授权 + 快速失败 + 可静态审计**。若未来引入远程第三方组件包分发，必须配套独立执行环境（iframe/worker 沙箱）与签名校验机制——当前版本明确不支持。

### 7.3 其他约束

- **12 列网格**：`columns` 有效范围受 `min/max` 夹取，建议 `max.columns ≤ 12`
- **可信构建代码**：能力字段用于审核、自描述和 SDK 存储检查，不是 JavaScript 安全沙箱；组件源码拥有与应用相同的页面权限，合并前必须审查
- **网络访问**：不要在客户端存放密钥，优先通过有校验、超时、限流和缓存的 Go 代理接口访问第三方数据
- **不要** 直接访问 `window.localStorage` / `document.cookie`，统一走 `useWidgetStorage`
- **不要** 在模块顶层做副作用请求；`load()` 只负责返回组件
- 扩展端（Chrome MV3）同样适用本 SDK；涉及远程资源请遵守扩展 CSP
