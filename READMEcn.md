# antigravityQuota

<img src="https://raw.githubusercontent.com/clhome/antigravityQuota/main/assets/icon.png" width="96" alt="antigravityQuota" />

[English](README.md) | **简体中文**

只做一件事：**在你的编辑器里查看 Antigravity 的配额**。

本项目是 [`antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit) 的
精简分支（fork）：原项目的自动唤醒、多账号管理与自动切号、在线公告、配额历史曲线、
桌面工具（Cockpit Tools）桥接、Antigravity Tools 凭证导入等功能已**整体移除**，
只保留状态栏 + 极简配额仪表盘。

## 安装

- **市场**：[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=clhome.antigravity-quota-yufeng)
  · [Open VSX](https://open-vsx.org/extension/clhome/antigravity-quota-yufeng)
- **离线**：从 [Releases](https://github.com/clhome/antigravityQuota/releases) 下载 `.vsix` 后
  `code --install-extension antigravity-quota-yufeng-<version>.vsix`

## 功能

- **状态栏**：常驻显示剩余最少的模型配额，悬停查看全部模型明细。
- **配额仪表盘**：一个极简 Webview 面板，列出每个模型的剩余百分比与重置倒计时。
- **原生通知**：配额耗尽或低于阈值时提示一次。
- **16 种语言**：跟随编辑器语言，或在设置中手动指定。

## 数据来源（重要）

配额**只**从一个地方读取：本机 Antigravity 进程自己启动的 language server
（`127.0.0.1:<随机端口>`，用该进程自己生成的 CSRF token 认证）。

因此：

- 不申请、不保存任何 Google / OAuth 凭证；
- 不访问任何外部域名（除回环地址外没有任何网络出口）；
- 没有定时唤醒、没有自动切号、没有多账号存储。

代价：Antigravity 必须正在运行；本扩展只反映**当前登录账号**的配额。

> 若你在 WSL/远程开发容器中运行编辑器，本机 language server 探测通常不可用。

## 设置

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| `antigravityQuota.refreshInterval` | `300` | 刷新间隔（秒），**硬下限 60 秒**，上限 3600 |
| `antigravityQuota.statusBarFormat` | `standard` | 状态栏格式（icon / dot / percent / compact / namePercent / standard） |
| `antigravityQuota.warningThreshold` | `30` | 警告阈值（%） |
| `antigravityQuota.criticalThreshold` | `10` | 危险阈值（%） |
| `antigravityQuota.notificationEnabled` | `true` | 是否弹出配额告警 |
| `antigravityQuota.dataMasked` | `false` | 遮罩账号名称与邮箱 |
| `antigravityQuota.logLevel` | `info` | 日志级别 |
| `antigravityQuota.language` | `auto` | 界面语言（16 种） |

## 命令

| 命令 | 命令 ID | 说明 |
| --- | --- | --- |
| `Antigravity: Open Quota Dashboard` | `antigravityQuota.open` | 打开配额面板（快捷键 `Ctrl/Cmd+Shift+Q`） |
| `Antigravity: Refresh Quota` | `antigravityQuota.refresh` | 立即刷新（60 秒冷却） |
| `Antigravity: Show Logs` | `antigravityQuota.showLogs` | 打开输出面板 |
| `Antigravity: Purge Legacy Plaintext Credentials` | `antigravityQuota.purgeLegacyData` | 扫描并删除旧版 Antigravity Cockpit 遗留的明文凭证文件 |

## 安全

见 [`docs/安全加固说明.md`](docs/安全加固说明.md)。摘要：

- **零凭证**：删除全部 OAuth 代码与 `client_secret` 常量，不读写任何 token。
- **零外联**：运行时只允许 `127.0.0.1` 回环请求；已移除公告拉取与外部工具桥。
- **零唤醒**：删除定时触发（不再周期性地向模型发送空请求）。
- **严格 CSP**：Webview 脚本走 nonce，无 `unsafe-inline` / `unsafe-eval`，禁用 `connect-src`，
  图片只允许扩展自身资源与 `data:`。
- **轮询限流**：60 秒硬下限 + ±10% 抖动 + 失败指数退避。
- **历史清理**：内置命令可扫描并删除旧版本写入 `~/.antigravity_cockpit` 的明文凭证残留。
- **源码级回归测试**：`src/test/security_invariants.test.ts` 把上述结论钉死在测试里。

## 开发

```bash
npm install
npm run typecheck
npm run lint
npm run build      # 或 npm run watch
npm test
```

要求 Node.js 20+。

## 来源与许可

- 源自 [`jlcodes99/vscode-antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit) 的精简分支（fork）。
- 许可：[Apache-2.0](LICENSE)。

## 发布

见 [`docs/PUBLISH.md`](docs/PUBLISH.md)：一键发布脚本 `npm run release`，
以及推送 `v*` tag 后由 GitHub Actions 自动发布到 VS Code Marketplace 与 Open VSX。
