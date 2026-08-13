# Panel Next 的完整备份与恢复

本功能独立实现于 MIT 开源基线之上。管理员可在应用启动器中打开“备份与恢复”，下载完整 ZIP，或上传由 Panel Next 生成且数据库驱动一致的 ZIP 并在重启后恢复。

## 数据范围

每个备份包含：

- 数据库：SQLite 一致性快照，或 MySQL 逻辑 JSON。
- 所有账号及其系统设置、分组、卡片、面板/搜索配置、文件记录和模块配置。
- 配置项 `source_path` 指向的全部上传文件，包括账号头像、图标和壁纸。
- `web/custom` 下的全局 `index.js`、`index.css` 等自定义资源。
- `manifest.json`：格式版本、应用版本、数据库驱动/模式、文件白名单、大小与 SHA-256。

备份包含密码哈希、登录令牌及用户上传内容，应当作为敏感文件加密保管并限制访问。ZIP 本身没有密码保护。

## 数据库策略

### SQLite

导出通过 SQLite `VACUUM INTO` 创建一致性数据库快照。恢复在数据库打开前完成，通过临时目录、同卷重命名和回滚目录替换数据库文件、上传目录和自定义目录。

### MySQL

不得复制外部 MySQL/PostgreSQL 的数据文件。Panel Next 在可重复读事务中读取以下业务表，并写入 `database/database.json`：

- `user`
- `system_setting`
- `item_icon_group`
- `item_icon`
- `user_config`
- `file`
- `module_config`

恢复时必须使用 MySQL 配置，且目标实例必须由相同版本的 Sun-Panel 完成数据库迁移。导入前会拒绝未知表、未知列、重复表/列、缺失表、畸形行和超量行；随后在单个数据库事务内清空并恢复白名单表。

当前格式支持 MySQL 实例之间的可移植迁移，不支持直接把 MySQL 逻辑包恢复到 SQLite，或把 SQLite 文件快照恢复到 MySQL。跨驱动迁移将在未来格式版本中另行设计，避免静默类型转换造成数据损坏。

## 恢复流程

1. 管理员上传 ZIP。
2. 服务验证 ZIP、manifest、格式版本、数据库驱动、路径、大小、压缩率和 SHA-256。
3. 服务自动创建 `pre-restore-*.zip` 快照。
4. 上传包保存为运行临时目录中的 `restore-pending.zip`。
5. 管理员重启服务。
6. SQLite 在数据库连接前恢复；MySQL 在建立连接并迁移模式后，以事务恢复逻辑数据。
7. 数据库或文件阶段失败时回滚已替换文件，并保留待恢复包与恢复前快照供诊断。

同一进程一次只允许一个导出或恢复请求。操作会写入审计日志，包括操作类型、状态、管理员用户 ID 和来源 IP。

## 验证命令

Windows 上 `go-sqlite3` 需要启用 CGO 并提供 MinGW-w64 GCC。配置完成后，在 `service` 目录执行：

```powershell
$env:CGO_ENABLED = '1'
$env:CC = '<mingw64>/bin/gcc.exe'
go test ./...
go vet ./...
```

### PostgreSQL 实机演练

2026-08-09 在 PostgreSQL 17.10 上完成独立低权限角色与数据库的新装和恢复演练：通过管理 API 导出逻辑备份，导出后修改探针数据，排队恢复并重启服务。恢复后探针回到备份值，PostgreSQL ID 序列已校准，待恢复包被消费且公开 API 正常。演练用探针、临时 ZIP 和恢复前快照已在验证后删除。

前端验证：

```powershell
pnpm run type-check
pnpm run build-only
```

生产启用 MySQL 前，必须在隔离测试实例演练一次导出、上传、重启恢复和恢复前快照回滚。
