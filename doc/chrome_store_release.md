# Panel Next Chrome Web Store 手工发布清单

> 用途：指引从本项目构建扩展 ZIP 到 Chrome Web Store（CWS）正式发布的完整流程。
> 关键约束：**扩展私钥（`.secrets/extension-key.pem`）与任何服务凭据绝不进入仓库或 CI 日志。**
> 当前状态：**测试版**。版本从 `0.0.1` 开始，只允许 `0.0.x`；进入正式发布阶段前必须单独评审并修改 `version-policy.json`。

## 1. 前置检查（每次发布前）

- [ ] `version-policy.json` 仍为 `testing`、`0.0` 系列，且 `service/assets/version` 当前值正确
- [ ] `package.json` 与 `extension/manifest.json` 的 `version` 与版本源一致
- [ ] `extension/manifest.json` 包含固定 `key`（公钥）——保证上传到 CWS 后扩展 ID 与本地加载一致
- [ ] 本地 `dist/extension` 通过 `pnpm run build:extension` 与 `node ./scripts/validate-extension.mjs`
- [ ] `pnpm run build:all` 全绿（架构校验、类型检查、双端构建）
- [ ] 已核对最小权限：仅 `storage` + `optional_host_permissions`（`http://*/*`、`https://*/*`）
- [ ] 已核对 CSP：`extension_pages` 为 `script-src 'self'; object-src 'self'`
- [ ] 已检查打包内容：无 `.map`、`.pem`、`.env`、密钥或服务端凭据

## 2. 生成扩展包

```bash
# 查看本次打包前版本；package:extension 会递增一次补丁号、构建并打包
cat service/assets/version
pnpm run package:extension
```

产物：

- `artifacts/panel-next-extension-v<本次版本>.zip`
- `artifacts/panel-next-extension-v<本次版本>.zip.sha256`

## 3. 准备商店素材

- **图标**：`public/logo.png`（128x128 及以上，建议提供 128/512）
- **截图**：桌面端新标签页截图（1280x800）、移动端截图（640x400）
- **简介**：说明项目定位、自托管、数据存储于用户服务器
- **隐私政策**：`doc/privacy.md` 需部署到可公开访问的 URL
- **官网/来源页**：`https://github.com/RoaycL/panel-next`

## 4. 上传到 Chrome Web Store

1. 登录 <https://chrome.google.com/webstore/devconsole>
2. 创建新项目，上传本次生成的 `panel-next-extension-v<本次版本>.zip`
3. 填写商店信息：
   - 名称：Panel Next
   - 简短描述：Self-hosted new-tab dashboard（自托管新标签页导航）
   - 详细描述 + 类别
   - 隐私权：勾选"需处理数据"并根据 `doc/privacy.md` 声明
4. 选择 **仅限通过审核的测试人员** 先内测，或提交公开审核

> 注意：CWS 拒绝包含 `key` 字段的 manifest 吗？——不会，CWS 会使用上传包的公钥；若包内已含 `key`，上传后商店生成的扩展 ID 应与之一致。请在上传后核对商店分配的 ID 是否等于 `gkmjlokenmbecapgnddickgkgfaflolb`。

## 5. 商店版扩展 ID 核对

上传后扩展 ID 由公钥派生，与本地 `chrome://extensions` 加载的一致。若不一致：

- 说明上传包与实际构建包的公钥不同
- 重新用仓库内 manifest 的 `key` 构建并上传

## 6. 密钥与凭据安全管理

| 项目 | 位置 | 要求 |
| --- | --- | --- |
| 扩展私钥 | `.secrets/extension-key.pem` | 仅开发者本机保存；**不提交仓库、不打印到 CI 日志** |
| 扩展公钥 | `extension/manifest.json` 的 `key` | 可公开，提交仓库 |
| Docker Hub 凭据 | GitHub Secrets（`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`） | 通过 `secrets.*` 引用，不写入日志 |
| 服务器凭据 | `docker-conf/conf.ini` 等 | 已 gitignore，绝不提交 |

## 7. 发布后验证

- [ ] 商店版扩展安装后新标签页覆盖生效
- [ ] 连接生产服务器 `https://next.roayc.com` 登录成功
- [ ] 打开卡片、编辑分组、同步刷新正常
- [ ] 重启浏览器后会话/缓存恢复（`EXT-08` 验收）

## 8. 版本升级

发新版时：

1. 确认 `service/assets/version` 是上一个测试包版本；测试阶段禁止脱离 `0.0.x`
2. 只运行第 2 节的 `pnpm run package:extension`，自动递增一次补丁版本并生成新 ZIP
3. 在 CWS 上传新 ZIP 提交审核
4. 用户在商店更新即可（扩展 ID 不变）

## 9. 回滚

CWS 支持保留历史版本，可回滚到上一已审核版本。本地固定 `key` 保证 ID 不变，回滚不影响用户已安装扩展。
