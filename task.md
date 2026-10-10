# task：antigravity-quotas 精简 + 安全加固

## 目标

这是一个 fork 的 VS Code 扩展（原 `antigravity-cockpit`）。目标：
1. **只保留最简配额查看**：状态栏 + 极简 Webview 仪表盘。
2. **彻底移除无关功能**：自动唤醒定时触发、多账号管理与自动切号、Cockpit Tools / WebSocket 桥、
   Antigravity Tools 凭证导入、在线公告拉取、配额历史曲线、跨进程共享配置。
3. **只走本地进程数据源**：从本机 Antigravity language server（`127.0.0.1` + csrf token）读配额，
   **不保存任何 Google 凭证、不做 OAuth**。
4. **修复 `docs/隐患.md` 全部条目**并提升可靠性与安全性。

## 用户已确认的决策

| 决策项 | 选择 |
| --- | --- |
| 精简范围 | 彻底精简 |
| 数据来源 | 仅本地进程（无凭证 / 无 OAuth） |
| OAuth scope | 移除 `cloud-platform`（本方案直接不保留 OAuth，故整体消失） |
| 界面形态 | 状态栏 + 简化仪表盘 |

## 隐患.md 条目 → 处置对照

| # | 隐患 | 处置 |
| --- | --- | --- |
| 一.1 | 明文凭证落盘（`~/.antigravity_cockpit`） | 删除全部落盘代码；新增 `legacy_cleanup` 检测并引导删除历史残留 |
| 一.2 | OAuth scope 过大（`cloud-platform`） | 删除 OAuth 服务与 `clientSecret` 常量，扩展不再申请任何 Google 权限 |
| 一.3 | 供应链/外联不透明（公告拉取、WebView 通信、桌面/WS 桥） | 删除公告服务、Webview 与外部工具桥；运行时仅允许 `127.0.0.1` 回环请求 |
| 二.1 | 自动唤醒（定时刷空请求） | 删除 `auto_trigger` 全部（scheduler/trigger/controller） |
| 二.2 | 多账号自动切换 | 删除多账号存储、`accountSwitchService`、Cockpit Tools WS 桥 |
| 二.3 | 模拟官方客户端调用内部 API | 移除内部 Cloud Code/OAuth 调用链（`cloudcode_client`/`cloudcode_base`）；本地进程接口为官方 LS 自持端口 |
| 二.4 | 高频轮询 | 默认 300s、最小 60s、加随机抖动、失败指数退避 |

## 拆解清单

### 阶段 A：清理无关模块
- [x] A01 删除 `src/auto_trigger/**`（自动唤醒 / OAuth / 凭证存储 / 本地凭证导入）
- [x] A02 删除 `src/announcement/**` + 根目录 `announcements*.json`
- [x] A03 删除 `src/antigravityTools_sync/**`
- [x] A04 删除 `src/services/**`（Cockpit Tools WS/桥、账号刷新、切号、历史、缓存、共享配置）
- [x] A05 删除 `src/controller/**`、`src/view/{hud,quickpick_view,accountTree}.ts`
- [x] A06 删除 `src/engine/reactor.ts`、`src/shared/{cloudcode_client,cloudcode_base,official_host_version,model_preference_migration,antigravity_paths}.ts` 与其测试
- [x] A07 删除多余 webview 资源（auto_trigger / auth_ui / accounts_overview / announcements / history / 多余 css）

### 阶段 B：重写最小内核
- [x] B01 `src/shared/constants.ts` 精简
- [x] B02 `src/shared/types.ts` 精简（仅配额 + 进程类型）
- [x] B03 `src/shared/i18n.ts` 精简为 en / zh-cn / auto
- [x] B04 `src/shared/config_service.ts` 精简
- [x] B05 `src/shared/env_guard.ts`：回环地址与端口校验、安全数值夹取
- [x] B06 `src/shared/legacy_cleanup.ts`：历史明文残留检测 + 清理
- [x] B07 `src/engine/strategies.ts` 加固（进程名白名单、`execFile` 友好）
- [x] B08 `src/engine/hunter.ts` 加固（端口/主机校验、超时、响应上限）
- [x] B09 `src/engine/quota_client.ts`：本地 `GetUserStatus` 取数与解析（自 reactor 移植）
- [x] B10 `src/engine/poller.ts`：间隔 + 抖动 + 指数退避
- [x] B11 `src/view/status_bar.ts` 精简
- [x] B12 `src/view/dashboard.ts` + `webview/dashboard.{js,css}`：极简面板 + 严格 CSP
- [x] B13 `src/extension.ts` 重写入口

### 阶段 C：工程与验证
- [x] C01 精简 `package.json`（命令/配置/依赖）并同步 `scripts/build.js`
- [x] C02 `npm install`（非交互）
- [x] C03 `npm run lint` 通过
- [x] C04 `npm run build` 通过
- [x] C05 `npm test` 通过
- [x] C06 新增安全回归测试（回环校验 / 端口夹取 / 退避 / 解析健壮性 / CSP）
- [x] C07 与 `docs/隐患.md` 逐条回归核对，输出 `docs/安全加固说明.md`
- [x] C08 清理临时产物，`git status` 核对

## 交付物
- 精简后的最小扩展源码（状态栏 + 仪表盘，本地进程取数）
- `docs/安全加固说明.md`（逐条对照隐患.md 的修复说明与剩余风险）
- 通过的 lint / build / test 结果

## 执行结果（2026-10-10）

**机器规模**：`src` 从 80 文件 / 33591 行 → 43 文件 / 5084 行；运行时依赖从 2 个 → **0 个**。

**门禁**：

```
tsc --noEmit          OK（0 error）
npm run lint          OK（0 error / 0 warning）
npm run build         OK（out/extension.js + out/view/webview/dashboard.{js,css}）
npx jest              7 suites / 74 tests / all passed
```

**新增测试**：

| 文件 | 项数 |
| --- | --- |
| `src/shared/env_guard.test.ts` | 回环白名单 / 端口 / token / 60s 硬下限 / 抖动 / 转义 |
| `src/shared/i18n.test.ts` | 16 语言键集合 + 占位符 + 非空译文一致性 |
| `src/shared/legacy_cleanup.test.ts` | 残留识别 / 精确清理 / 符号链接与越界拒绝 / 第三方目录保护 |
| `src/engine/quota_client.test.ts` | 解析边界、越界夹取、错误分类、离线快照 |
| `src/engine/poller.test.ts` | 硬下限 / 指数退避封顶 / 成功回落 / single-flight / stop |
| `src/engine/strategies.test.ts`（扩充） | 命令注入拒绝 / 非法 PID / 超长输出 / 端口范围 |
| `src/test/security_invariants.test.ts` | 源码级不变量（无外联 / 无 OAuth / 无宽松 CSP / 无原始 HTML 注入） |

**关键实现取舍**：

- 数据源只有本机 language server（`GetUserStatus`），凭证面为 0；
- 本地 TLS 自签名证书仍不校验证书（`rejectUnauthorized: false`），但该连接不再承载任何长期凭证，
  该点已在 `docs/安全加固说明.md` 第四节如实登记为遗留项；
- WSL/远程容器下本机 language server 探测不可用（上游既有局限，未纳入本次范围）。

---

# task：更名为 antigravityQuota + 市场自动发布（2026-10-10）

## 目标

把扩展的发布身份从上游 `jlcodes/antigravity-cockpit` 切到本仓库
[`clhome/antigravityQuota`](https://github.com/clhome/antigravityQuota)，并打通
「一条命令 / 一个 tag」即可发布到 VS Code Marketplace 与 Open VSX 的自动化链路。

## 用户已确认的决策

| 决策项 | 选择 |
| --- | --- |
| publisher | `clhome` |
| 发布目标 | VS Code 官方市场 + Open VSX，均用 Token（`VSCE_PAT` / `OVSX_TOKEN`） |
| 命名空间 | 全面改名：命令 ID 与配置前缀 `agCockpit.*` → `antigravityQuota.*` |
| 图标 | `logo.webp` → `assets/icon.png`（256×256 PNG）作扩展图标与面板徽标；`favicon.ico` 作面板页图标并随 VSIX 分发 |

> 市场规范：`package.json.name` 必须是小写标识（市场用它拼扩展 ID 与 URL），
> 因此 `name=antigravity-quota`、`displayName=antigravityQuota`，扩展 ID 为
> `clhome.antigravity-quota`。图标市场只接受 PNG ≥128×128（webp / ico / svg 均不合格），
> 故 webp 原图不能直接当 `icon` 用。

## 拆解清单

### 阶段 A：改名
- [x] A01 `package.json`：name / displayName / publisher / repository / bugs / license + 命令与配置 ID
- [x] A02 `src/shared/constants.ts`：新增 `EXTENSION_ID` 统一命名空间，命令 / 配置 / 输出通道由它派生
- [x] A03 `log_service.ts` / `dashboard.ts`：配置读取、viewType、面板图标改为常量
- [x] A04 `CockpitConfig` → `ExtensionConfig`；全部文件头注释改为 antigravityQuota
- [x] A05 README（中/英）与 `docs/安全加固说明.md` 同步改名，补安装与发布章节

### 阶段 B：图标
- [x] B01 用 sharp 从 `logo.webp` 生成 `assets/icon.png`（256×256 PNG）
- [x] B02 `favicon.ico` 进 VSIX 并作为仪表盘页图标（`<link rel="icon">`）；顶栏徽标用 `icon.png`（避免 ico 在 `<img>` 中的渲染兼容风险）

### 阶段 C：发布链路
- [x] C01 重写 `scripts/release.sh`（跨平台：去掉 macOS 专有 `sed -i ''`，版本号走 `npm version`）
- [x] C02 新增 `.github/workflows/release.yml`（build → marketplace / open-vsx / github-release）
- [x] C03 新增 `.gitattributes`（强制 LF，抵消本机 `core.autocrlf=true`）
- [x] C04 `docs/PUBLISH.md`：前置准备（publisher / PAT / Open VSX / Secrets）、一键发布、排错表

### 阶段 D：验证
- [x] D01 typecheck / lint / jest 全绿
- [x] D02 `vsce package` 产物核对（11 个文件，无 src / test / docs 泄漏）
- [x] D03 `release.sh` 端到端冒烟（临时仓库 + 本地 bare 远端：改版本 → 测试 → 打包 → tag → push）
- [x] D04 失败路径校验（tag 重复 / 脏工作区 / 缺 token / 伪 token 发布被两个注册表拒绝）
- [x] D05 清理临时探针（`test/`）

## 执行结果（2026-10-10）

- 扩展 ID `clhome.antigravity-quota`，展示名 `antigravityQuota`，图标 `assets/icon.png`。
- `npm run release [-- <version>]` = 校验 → 测试 → 打包 → 打 tag → 推送；推送后 GitHub Actions
  自动发布两个市场并创建 Release（两者的发布步骤都带 `--skip-duplicate`，可重复执行）。
  `--publish` 则在本机直接发布（需 `VSCE_PAT` / `OVSX_TOKEN`）。
- 冒烟：临时仓库跑通 v2.1.53 全流程；伪 token 已验证两条发布命令都能抵达注册表（仅鉴权失败）。
- 产物：`dist/antigravity-quota-<version>.vsix`，11 个文件
  （LICENSE / README×2 / package.json / assets{icon.png,favicon.ico} / out）。
- `test/` 内的一次性探针（sharp 装包目录、临时发布仓库）已全部删除。

## 发布前需由用户执行（一次性）

1. 在 VS Code Marketplace 创建 publisher `clhome`，生成 PAT（Scope：Marketplace → Manage）。
2. 创建 Open VSX 命名空间并生成 token：`npx ovsx create-namespace clhome -p <token>`。
3. 仓库 Secrets 配置 `VSCE_PAT` 与 `OVSX_TOKEN`。
4. 提交当前改动后执行 `npm run release -- 1.0.0`（若要首个市场版本从 1.0.0 开始）。
