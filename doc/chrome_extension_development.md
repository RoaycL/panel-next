# Chrome 扩展开发说明

## 当前阶段

当前完成 `EXT-01` 与 `EXT-02`：仓库可以生成 Manifest V3 新标签页扩展，Web 与扩展共用 Vue 入口；本地存储和打开 URL 已通过运行环境适配器访问。

当前扩展仍是最小构建原型：

- 尚未接入 `chrome.storage.local`，暂时使用扩展页面自身的 localStorage。
- 尚未提供服务器地址设置和 `host_permissions` 请求流程。
- `/api` 在扩展 Origin 下不可用，因此当前包只用于验证打包、CSP 和新标签页入口，不能完成远程登录同步。
- 尚未执行 Chrome 开发者模式人工安装验收。

上述限制分别由 `EXT-03`、`EXT-04`、`EXT-05` 和 `EXT-08` 跟踪，不应通过扩大默认权限临时绕过。

## 构建

必须使用项目声明的 pnpm 版本：

```powershell
corepack pnpm install
corepack pnpm run type-check
corepack pnpm run build:web
corepack pnpm run build:extension
```

也可以一次执行：

```powershell
corepack pnpm run build:all
```

产物：

- Web：`dist`
- Chrome 扩展：`dist/extension`

注意：Web 构建会清空 `dist`，因此需要同时产出两端时必须先构建 Web，再构建 Extension；`build:all` 已使用正确顺序。

## 本地加载

1. 执行 `corepack pnpm run build:extension`。
2. 打开 `chrome://extensions`。
3. 启用开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 选择仓库中的 `dist/extension`。
6. 打开一个新标签页，确认浏览器加载 `newtab.html`。

当前阶段不要发布到 Chrome Web Store。人工验证结果应记录在 `TODO.md` 的 `EXT-08` 条目后，并包含 Chrome 版本、扩展 ID、安装结果和已知错误。

## 产物安全检查

- `manifest.json` 必须为 Manifest V3。
- `chrome_url_overrides.newtab` 必须指向包内的 `newtab.html`。
- 所有脚本必须为包内相对资源，不允许远程脚本或 `unsafe-eval`。
- 未实现的能力不得预先申请权限。
- `dist/extension` 不得包含 `.env`、服务器凭据、源码映射或开发日志。
