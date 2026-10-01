# 第三方主题与小组件包

Web 与扩展均支持 JSON 数据包的本地导入、远程 HTTPS 安装、导出、删除和手动检查更新。
入口：主题中心；扩展的「添加图标 → 小组件」也提供小组件包管理。

## 安装与保存

- 从文件导入，或输入公开 HTTPS JSON 地址；远程安装需确认名称、版本、作者、来源及内容摘要。
- 只有保存成功才会启用。刷新后自动恢复，失败保留原版本。
- 主题安装后进入预览，点击主题中心「保存」才正式应用。删除正在使用的主题会先保存默认主题。
- 远程安装记录原地址，可以检查更新；更新必须保持类型及 ID，相同版本不得改变内容，禁止降级。
- 更新需逐次确认，不后台自动下载或自动启用。纯本地导入不具备远程来源，请通过远程地址安装以启用检查更新。
- 包保存在当前运行端／站点的本地存储，不随账号跨设备分发；主题选择沿用原有 Web／扩展保存流程。
- 最多 50 个包，共 4 MB；单个 JSON 最大 2 MB。版本为 1–1000 的整数。
- Web 发布者必须允许 CORS；扩展只请求该来源的访问权限。下载不发送账号 token、cookies 或 referrer，15 秒超时，不跟随重定向。
- SHA-256 用于内容一致性检查，不是作者签名。没有主题商店、签名认证或第三方任意代码执行能力。

## 主题包

参见 `theme-development.md` 的 Theme SDK Token 清单。当前安装器支持单文件 JSON，不支持 ZIP，也不安装附带图片／字体资源。壁纸仍由独立壁纸设置管理。

```json
{
  "format": "panel-next-theme-package",
  "formatVersion": 1,
  "theme": {
    "id": "acme.lavender",
    "version": 1,
    "meta": { "name": "薰衣草磨砂", "author": "Acme" },
    "tokens": {
      "light": {
        "color": { "surface": "rgba(245,240,255,0.7)", "surfaceOverlay": "rgba(245,240,255,0.2)", "surfaceHover": "rgba(245,240,255,0.42)", "accent": "#7654b8" },
        "modal": { "background": "rgba(245,240,255,0.74)" },
        "effect": { "blur": "24px" }
      },
      "dark": {
        "color": { "surface": "rgba(30,20,48,0.7)", "surfaceOverlay": "rgba(180,140,255,0.04)", "surfaceHover": "rgba(180,140,255,0.08)", "accent": "#c1a0ff", "border": "rgba(180,140,255,0.18)" },
        "modal": { "background": "rgba(30,20,48,0.74)" },
        "notification": { "background": "rgba(30,20,48,0.92)" },
        "effect": { "blur": "24px" }
      }
    }
  }
}
```

当前日白夜黑的磨砂外观已声明为 `core.default`；可「导出当前主题」作为开发模板。
玻璃层映射：surface → 主表面；surfaceOverlay → 内层面板；surfaceHover → 控件；
modal.background → 弹窗；notification.background → 浮层；border → 玻璃边缘；
mask → 遮罩；effect.blur → 模糊；effect.shadowHigh → 浮层阴影。
透明度直接包含在 rgba 中，夜间不再固定覆盖。系统降低透明度偏好仍优先，保证可读性。

## 小组件包

可远程安装的是**声明式数据小组件**，不是 JS／Vue 可执行插件。
所有渲染逻辑随应用打包；支持文字、数值和 HTTP(S) 快捷链接，不支持 HTML、CSS、脚本、表达式、远程接口及宿主权限请求。
组件可在 1×1 至 4×2 之间调整尺寸，超出的内容在卡片内滚动。

```json
{
  "format": "panel-next-widget-package",
  "formatVersion": 1,
  "plugin": {
    "id": "acme.shortcuts",
    "version": 1,
    "name": "开发快捷入口",
    "author": "Acme",
    "description": "常用开发站点",
    "size": { "columns": 2, "rows": 2 },
    "blocks": [
      { "kind": "text", "label": "今日提醒", "value": "留一点空间，给重要的事" },
      { "kind": "metric", "label": "本周目标", "value": "3" },
      { "kind": "link", "label": "GitHub", "url": "https://github.com" }
    ]
  }
}
```

删除包不会删除已有桌面布局数据；重新安装后可恢复，必要时刷新页面。
需要自定义逻辑的小组件继续通过 Widget SDK 源码接入、审核后打包。
# 日间与夜间壁纸

主题清单可声明 `theme.wallpapers: { "light": "https://example.com/day.jpg", "dark": "https://example.com/night.jpg" }`。
仅声明 `light` 时两种模式共用该壁纸；空字符串表示纯色背景。不声明时兼容旧桌面壁纸。
壁纸采用图片地址引用（HTTP/HTTPS 或站内绝对路径），不执行代码，不支持 data URL 或内嵌资源包。

「主题与壁纸」可以编辑当前主题的日/夜壁纸，默认主题也支持。个人覆盖按主题 ID 保存，切换主题后不会丢失；导出主题包会包含当前两种壁纸。跟随系统模式会切换对应壁纸。同步只传递壁纸覆盖与背景效果，不修改另一端的主题选择或布局。
