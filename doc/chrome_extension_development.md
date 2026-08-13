# Chrome 扩展开发说明

## 当前阶段

当前完成 `EXT-01` 至 `EXT-07`：仓库可以生成、校验和打包 Manifest V3 新标签页扩展，Web 与扩展共用业务核心并使用不同布局；扩展可配置、验证和切换自托管服务器。

当前实现：

- 扩展启动时先把 `chrome.storage.local` 预加载为同步内存镜像，再初始化 Pinia；写入会同步回 Chrome 存储。
- Manifest 默认只授予 `storage`，HTTP/HTTPS 主机访问声明为可选权限；用户点击连接时才申请所填 Origin 的访问权。
- 服务器地址只接受不带路径、查询或凭据的 HTTP/HTTPS Origin，并通过 `/api/openness/loginConfig` 验证兼容性。
- 会话和本地状态以服务器 Origin 为键空间隔离；切换成功后撤销旧服务器的主机权限并重新加载应用。
- Extension 使用稳定且按服务器 Origin 隔离的设备 ID，通过 `/api/v1/sessions/login` 获取短期 Access Token 和可轮换 Refresh Token。
- 已保存的历史 Token 会在启动时调用 `/api/v1/sessions/upgrade` 自动换成设备会话；升级成功后服务端立即删除旧 Token 映射。网络失败会保留旧 Token 供后续重试，服务端明确拒绝时返回登录页。
- 多个扩展新标签页使用 Web Locks 与 `chrome.storage.local` 同步协调刷新，避免重复消费同一个 Refresh Token。
- 后端已提供设备会话保护的 `/api/v1/sync/bootstrap`，一次返回账号摘要、面板配置、搜索引擎和嵌套卡片的有序分组；Extension 已完成本地快照写入和缓存首屏。
- Extension 已在在线 bootstrap 成功后缓存最近一次完整快照；缓存由服务器 Origin 和账号 ID 双重隔离，最大 5 MiB，读取与写入都执行 schema、revision、时间、ID 和分组归属校验，损坏缓存会被丢弃。
- Extension 会在首次渲染前应用可信缓存，再后台请求 bootstrap；状态胶囊区分同步中、已同步、缓存刷新、离线缓存和无缓存不可用，点击可手动重试。
- 传输失败按 0、1、3 秒进行最多三次尝试，恢复在线时立即再试；认证/API 错误不重试。离线或缓存状态隐藏编辑入口，离线写入仍属于后续增强范围。
- 后端已提供账号隔离的 `/api/v1/sync/changes` 分页接口（默认 200、最大 500），前端会严格校验字符串 revision、顺序、资源类型、操作与删除载荷。可信游标直接取自最近一次已应用的 bootstrap 快照，避免独立游标超前。
- 在 `SYNC-07` 把所有写操作接入变更日志及冲突控制前，Extension 仍使用完整 bootstrap 后台刷新，不会提前切换到不完整的增量数据源。
- Web 模式仍使用当前站点的同源 `/api`，不显示扩展服务器配置页。
- 扩展根路由使用独立的新标签页布局外壳：紧凑的 Logo/时钟顶部区域、全宽搜索、响应式玻璃分组网格；数据加载、卡片交互和设置能力继续复用共享首页核心。Web 路由保持原布局。

当前限制：

- 扩展登录守卫与首页数据加载已通过构建检查，尚待桌面 Chrome 手工验收。
- 尚未执行 Chrome 开发者模式人工安装验收。

上述限制由 `SESSION-08` 和 `EXT-08` 跟踪，不应通过扩大默认权限临时绕过。

## 服务端 CORS 配置

Chrome 加载扩展后，在 `chrome://extensions` 复制其 32 位扩展 ID，并写入服务端 `service/conf/conf.ini`：

```ini
[cors]
web_origins=https://admin.example.com
extension_ids=abcdefghijklmnopabcdefghijklmnop
```

- 多个值使用英文逗号分隔；不需要额外跨源 Web 时将 `web_origins` 留空。
- Web 同源请求无需加入白名单；反向代理必须传递原始 `Host` 和 `X-Forwarded-Proto`。
- 不接受 `*`、`null`、带路径的 URL 或非 32 位 Chrome ID。修改配置后需要重启服务。
- 预检只允许 `GET`、`POST`、`DELETE` 及项目实际使用的认证、语言、内容类型和版本头；不启用跨源 Cookie 凭据。

## 构建

必须使用项目声明的 pnpm 版本：

```powershell
corepack pnpm install
corepack pnpm run type-check
corepack pnpm run build:web
corepack pnpm run build:extension
corepack pnpm run package:extension
```

也可以一次执行：

```powershell
corepack pnpm run build:all
```

产物：

- Web：`dist`
- Chrome 扩展：`dist/extension`
- 发布 ZIP 与 SHA-256：`artifacts/panel-next-extension-v<version>.zip[.sha256]`

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
