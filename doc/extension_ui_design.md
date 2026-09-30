# 扩展 UI：简约工作空间

参考 iTab 的时钟、搜索、分组与组件布局，使用低饱和的中性色建立层次。

## 视觉规则

- 浅色画布 `#f3f5f0`、白色表面、松绿强调色 `#466b56`。
- 深色画布 `#1c231f`、石墨绿表面 `#252d29`、柔绿强调色 `#97bba4`。
- 主要正文 12–14px，分组标题 18px，时钟自适应 64–108px。
- 控件圆角 8–12px，卡片与主弹窗圆角 20px；边框和轻阴影用于区分层次。
- 只给独立浮层使用轻量模糊，面板内部以可读的实色表面为主。
- 新用户默认使用纯色画布，已有壁纸设置保留；壁纸上的文字使用白色与柔和阴影。
- 侧栏保留左右位置、自动隐藏和密度设置；添加入口与编辑入口并列。
- 设置、添加中心、组件预览、搜索结果、登录和通知共享主题变量。
- 窄屏设置导航横向滚动，组件占满内容宽度；支持键盘焦点与减少动态效果偏好。

## 实现范围

`extensionDefaultTokens()` 只作用于扩展的 `core.default` 主题。网页端的默认颜色、外部主题以及用户显式的 token 覆盖继续有效。主题中心缩略预览与页面使用同一解析入口。

布局继续采用已有的 12 列混排网格、拖动排序和组件尺寸协议。书签、账户、服务器与同步接口不变。

## 验证

- `pnpm run type-check`
- 对修改的 TypeScript、Vue、测试脚本运行 ESLint
- `pnpm run validate:theme-registry`：包含新增的扩展浅色／深色、默认回退、用户覆盖与外部主题隔离验证
- `pnpm run validate:responsive-ui`
- `pnpm run validate:dashboard-core`
- `pnpm run validate:architecture`
- `pnpm run test:extension-persistence`
- `pnpm run build:extension`：构建并校验 Manifest V3 产物

Playwright 对构建产物进行桌面与窄屏预览，检查明暗切换、设置导航、侧栏显示、书签搜索、添加便签／月历和刷新后的本地恢复。预览使用隔离的模拟 Chrome Storage 与服务响应，不代表真实账户登录、Chrome 权限授权或云端同步验证。

扩展构建位于 `dist/extension`，在浏览器扩展管理页加载该目录即可检查。新版界面随 `v0.0.34` 测试版发布，版本递增与安装包由项目的事务式打包脚本生成。
