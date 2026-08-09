# Chrome 扩展开发说明

## 当前阶段

当前完成 `EXT-01` 至 `EXT-04`：仓库可以生成 Manifest V3 新标签页扩展，Web 与扩展共用 Vue 入口；扩展可配置、验证和切换自托管服务器。

当前实现：

- 扩展启动时先把 `chrome.storage.local` 预加载为同步内存镜像，再初始化 Pinia；写入会同步回 Chrome 存储。
- Manifest 默认只授予 `storage`，HTTP/HTTPS 主机访问声明为可选权限；用户点击连接时才申请所填 Origin 的访问权。
- 服务器地址只接受不带路径、查询或凭据的 HTTP/HTTPS Origin，并通过 `/api/openness/loginConfig` 验证兼容性。
- 会话和本地状态以服务器 Origin 为键空间隔离；切换成功后撤销旧服务器的主机权限并重新加载应用。
- Web 模式仍使用当前站点的同源 `/api`，不显示扩展服务器配置页。

当前限制：

- 尚未完成扩展端真实账号登录及首页数据加载验收。
- 当前使用的是历史登录 Token 原型，后续必须迁移到可撤销的设备会话。
- 尚未执行 Chrome 开发者模式人工安装验收。

上述限制分别由 `EXT-05`、`EXT-06`、`SESSION-*` 和 `EXT-08` 跟踪，不应通过扩大默认权限临时绕过。

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
7. 输入服务器 Origin（例如 `https://panel.example.com`），确认 Chrome 只请求该站点权限。
8. 连接成功后可通过页面右下角“服务器”入口切换实例。

当前阶段不要发布到 Chrome Web Store。人工验证结果应记录在 `TODO.md` 的 `EXT-08` 条目后，并包含 Chrome 版本、扩展 ID、安装结果和已知错误。

## 产物安全检查

- `manifest.json` 必须为 Manifest V3。
- `chrome_url_overrides.newtab` 必须指向包内的 `newtab.html`。
- 所有脚本必须为包内相对资源，不允许远程脚本或 `unsafe-eval`。
- 未实现的能力不得预先申请权限。
- `dist/extension` 不得包含 `.env`、服务器凭据、源码映射或开发日志。
