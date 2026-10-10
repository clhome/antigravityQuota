# 发布指南（antigravityQuota）

## 1. 发布标识

| 项 | 值 |
| --- | --- |
| 发布者（publisher） | `clhome` |
| 扩展名（`package.json.name`） | `antigravity-quota` |
| 扩展 ID | `clhome.antigravity-quota` |
| 市场地址 | https://marketplace.visualstudio.com/items?itemName=clhome.antigravity-quota |
| Open VSX | https://open-vsx.org/extension/clhome/antigravity-quota |
| 仓库 | https://github.com/clhome/antigravityQuota |

> `name` 必须是小写无空格的标识（市场用它拼扩展 ID 与 URL）；面向用户的展示名是
> `package.json.displayName`（当前为 `antigravityQuota`）。

## 2. 前置准备（只需做一次）

1. **创建发布者**：在 [VS Code Marketplace 管理页](https://marketplace.visualstudio.com/manage)
   用微软账号创建 ID 为 `clhome` 的 publisher（ID 创建后不可修改）。
2. **生成 Marketplace PAT**：Azure DevOps → User settings → Personal access tokens，
   组织选 `All accessible organizations`，Scope 勾选 **Marketplace → Manage**。
3. **创建 Open VSX 命名空间与令牌**：
   ```bash
   npx ovsx create-namespace clhome -p <你的-openvsx-token>
   ```
   令牌在 https://open-vsx.org/user-settings/tokens 生成。
4. **配置 GitHub Secrets**（仓库 → Settings → Secrets and variables → Actions）：
   | Secret | 用途 |
   | --- | --- |
   | `VSCE_PAT` | 发布到 VS Code Marketplace |
   | `OVSX_TOKEN` | 发布到 Open VSX（workflow 会转成 ovsx 需要的 `OVSX_PAT`） |

   未配置的 Secret 对应的发布任务只会打 warning 并跳过，不会让整个流程失败。

## 3. 一键发布（本地）

```bash
# 用当前版本号发布：校验 → 测试 → 打包 → 打 tag → 推送（由 Actions 发布到市场）
npm run release

# 先改版本号再发布
npm run release -- 2.1.53

# 本机直接发布到两个市场（需要 VSCE_PAT / OVSX_TOKEN 环境变量）
VSCE_PAT=xxx OVSX_TOKEN=yyy npm run release -- 2.1.53 --publish

# 只做测试与打包，不改版本、不提交、不推送
npm run release -- --dry-run
```

可选参数：`--publish`（本机发布）、`--skip-tests`、`--no-push`、`--dry-run`、`-h`。

脚本在 Windows / macOS / Linux 上均可执行（Windows 用 Git Bash）。
产物固定在 `dist/<name>-<version>.vsix`。

## 4. 自动发布（推荐）

推送 `v*` tag 即触发 [`.github/workflows/release.yml`](../.github/workflows/release.yml)：

```
git push origin v2.1.53
        ↓
build           校验 tag 与 package.json 版本一致 → npm test → 打包 VSIX → 上传 artifact
        ↓
marketplace     vsce publish --packagePath（Secret: VSCE_PAT）
open-vsx        ovsx publish --packagePath（Secret: OVSX_TOKEN）
github-release  gh release create/upload（附上同一个 VSIX）
```

三个发布任务消费的是**同一个** VSIX 产物，避免各市场内容不一致。
两个发布步骤都带 `--skip-duplicate`，重复执行同一版本不会让流程报错。

## 5. 版本号规则

遵循语义化版本，tag 必须与 `package.json.version` 完全一致（去掉前缀 `v`）：

- 不兼容变更 → 主版本 `v3.0.0`
- 新增功能 → 次版本 `v2.2.0`
- 缺陷修复 → 修订号 `v2.1.53`

## 6. 图标

市场要求扩展图标是 **PNG，至少 128×128**（256×256 适配 Retina），不接受 `webp` / `ico` / `svg`。

- `assets/icon.png`：扩展图标（市场列表、扩展详情、面板标签页）与仪表盘顶栏徽标，`package.json.icon` 指向它；
- `assets/favicon.ico`：仪表盘页图标（`<link rel="icon">`），随 VSIX 一起发布；可见 UI 用 PNG 而不是 ico，是为避免 ico 在 `<img>` 中的渲染兼容风险；
- `assets/logo.webp`：设计稿原图，不打包。

需要用 `logo.webp` 重新生成 `icon.png` 时（本地临时安装 sharp，装完即删）：

```bash
mkdir -p test/icon && cd test/icon
printf '{"name":"icon-tools","private":true,"version":"0.0.0"}\n' > package.json
npm install sharp --no-audit --no-fund
node -e "require('sharp')('../../assets/logo.webp').resize(256,256,{fit:'contain'}).png({compressionLevel:9}).toFile('../../assets/icon.png').then(i=>console.log(i))"
```

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| `ERROR The extension 'clhome.antigravity-quota' already exists` | 版本号重复；换新版本号，或确认 `--skip-duplicate` 已生效 |
| `401` / `403` 发布失败 | PAT 过期或 Scope 缺少 Marketplace → Manage；重新生成并更新 Secret |
| Open VSX `Namespace not found` | 先执行 `npx ovsx create-namespace clhome -p <token>` |
| `tag vX.Y.Z 与 package.json 版本 X.Y.Z 不一致` | Actions 的 build 任务拦住了错配；改 tag 或改 `package.json` 后重新打 tag |
| README 图片在市场上不显示 | 市场只渲染绝对 `https` 图片地址，不要用相对路径 |
| `vsce` 报缺少 LICENSE | 仓库根目录必须有 `LICENSE`（当前为 Apache-2.0） |
| 想只出包不发市场 | `npm run release -- --dry-run` 或 `--no-push` |
