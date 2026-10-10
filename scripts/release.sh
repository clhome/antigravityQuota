#!/usr/bin/env bash
#
# antigravityQuota 一键发布脚本（Git Bash / WSL / macOS / Linux 通用）
#
# 默认流程：校验工作区 → 改版本号 → 测试 → 打包 VSIX → 打 tag → 推送
# 推送 tag 后会由 GitHub Actions 自动发布到 VS Code 市场与 Open VSX，并创建 Release。
#
# 用法：
#   bash scripts/release.sh                    # 用当前版本号发布
#   bash scripts/release.sh 2.1.53             # 先改到 2.1.53 再发布
#   bash scripts/release.sh 2.1.53 --publish   # 本机直接发布到两个市场（需 VSCE_PAT / OVSX_TOKEN）
#
# 选项：
#   --publish     本机直接发布（默认只推 tag，交给 GitHub Actions 发布）
#   --skip-tests  跳过 jest
#   --no-push     不推送分支与 tag（只产出本地 VSIX）
#   --dry-run     只做测试与打包，不改版本、不提交、不推送、不发布
#   -h, --help    显示帮助
#
# 本机发布所需环境变量：
#   VSCE_PAT    VS Code Marketplace 的 Personal Access Token
#   OVSX_TOKEN  Open VSX Registry 的 Access Token（脚本会转成 ovsx 需要的 OVSX_PAT）

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

PUBLISH=0
SKIP_TESTS=0
NO_PUSH=0
DRY_RUN=0
NEW_VERSION=""

usage() {
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() {
    echo "❌ $*" >&2
    exit 1
}

step() {
    echo ""
    echo "▶ $*"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --publish) PUBLISH=1 ;;
        --skip-tests) SKIP_TESTS=1 ;;
        --no-push) NO_PUSH=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            die "未知选项：$1（用 -h 查看帮助）"
            ;;
        *)
            [ -n "$NEW_VERSION" ] && die "只接受一个版本号参数"
            NEW_VERSION="$1"
            ;;
    esac
    shift
done

for bin in node npm git; do
    command -v "$bin" >/dev/null 2>&1 || die "未找到命令：$bin"
done

if [ -n "$NEW_VERSION" ] && ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
    die "版本号格式非法：$NEW_VERSION（应为语义化版本，如 2.1.53）"
fi

read_pkg() {
    node -p "require('./package.json').$1"
}

# ---------------------------------------------------------------- 前置校验

step "校验工作区"
if [ "$DRY_RUN" -eq 0 ]; then
    [ -n "$(git status --porcelain)" ] && die "工作区有未提交改动，请先提交或贮藏（git status 查看）"
    echo "  工作区干净"
else
    echo "  --dry-run：跳过工作区干净检查"
fi

if [ "$PUBLISH" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] \
    && [ -z "${VSCE_PAT:-}" ] && [ -z "${OVSX_TOKEN:-}" ]; then
    die "--publish 需要环境变量 VSCE_PAT（VS Code 市场）或 OVSX_TOKEN（Open VSX）"
fi

if [ -n "$NEW_VERSION" ] && [ "$DRY_RUN" -eq 0 ]; then
    step "更新版本号到 ${NEW_VERSION}"
    npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null
    git add package.json
    [ -f package-lock.json ] && git add package-lock.json
    git commit -m "chore: release v${NEW_VERSION}" >/dev/null
    echo "  已提交版本号变更"
fi

VERSION=$(read_pkg version)
NAME=$(read_pkg name)
PUBLISHER=$(read_pkg publisher)
REPO_URL=$(node -p "String(require('./package.json').repository.url).replace(/\.git$/, '')")
TAG="v${VERSION}"
EXTENSION_ID="${PUBLISHER}.${NAME}"
VSIX="dist/${NAME}-${VERSION}.vsix"

step "发布信息"
echo "  扩展标识：${EXTENSION_ID}"
echo "  版本号：  ${VERSION}（tag ${TAG}）"
echo "  产物路径：${VSIX}"

if [ "$DRY_RUN" -eq 0 ] && git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    die "tag ${TAG} 已存在，请换一个版本号"
fi

# ---------------------------------------------------------------- 编译与打包

step "清理旧产物"
rm -rf out dist
mkdir -p dist
echo "  已清理 out/ 与 dist/"

if [ ! -d node_modules ]; then
    step "安装依赖"
    if [ -f package-lock.json ]; then
        npm ci --no-audit --no-fund
    else
        npm install --no-audit --no-fund
    fi
fi

if [ "$SKIP_TESTS" -eq 0 ]; then
    step "运行测试（jest）"
    npm test
else
    echo ""
    echo "⚠️  --skip-tests：已跳过测试"
fi

step "打包 VSIX"
# vsce package 会触发 vscode:prepublish（typecheck + lint + build:prod）
npm run package -- --out "$VSIX" --no-dependencies

[ -f "$VSIX" ] || die "未生成 ${VSIX}"
echo "  打包完成：${VSIX}（$(wc -c < "$VSIX" | tr -d ' ') 字节）"

# ---------------------------------------------------------------- 本机发布（可选）

if [ "$PUBLISH" -eq 1 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
        echo ""
        echo "⚠️  --dry-run：跳过本机发布"
    else
        if [ -n "${VSCE_PAT:-}" ]; then
            step "发布到 VS Code Marketplace"
            npx --no-install vsce publish --packagePath "$VSIX" --skip-duplicate
        else
            echo ""
            echo "⚠️  未设置 VSCE_PAT：跳过 VS Code 市场"
        fi

        if [ -n "${OVSX_TOKEN:-}" ]; then
            step "发布到 Open VSX Registry"
            OVSX_PAT="$OVSX_TOKEN" npx --no-install ovsx publish --packagePath "$VSIX" --skip-duplicate
        else
            echo ""
            echo "⚠️  未设置 OVSX_TOKEN：跳过 Open VSX"
        fi
    fi
fi

# ---------------------------------------------------------------- tag 与推送

if [ "$DRY_RUN" -eq 1 ]; then
    echo ""
    echo "⚠️  --dry-run：跳过 tag 与推送"
else
    step "创建 tag ${TAG}"
    git tag -a "$TAG" -m "Release ${VERSION}"
    echo "  已创建 ${TAG}"

    if [ "$NO_PUSH" -eq 1 ]; then
        echo ""
        echo "⚠️  --no-push：未推送（需手动 git push origin HEAD && git push origin ${TAG}）"
    else
        step "推送到远端"
        git push origin HEAD "$TAG"
    fi
fi

echo ""
echo "✅ 发布流程结束"
echo ""
echo "  产物：    ${VSIX}"
echo "  扩展 ID： ${EXTENSION_ID}"
echo "  Actions： ${REPO_URL}/actions"
echo "  Release： ${REPO_URL}/releases"
echo "  市场：    https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}"
echo "  Open VSX：https://open-vsx.org/extension/${PUBLISHER}/${NAME}"
if [ "$PUBLISH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$NO_PUSH" -eq 0 ]; then
    echo ""
    echo "  GitHub Actions 将自动发布到上述两个市场，并创建 GitHub Release。"
fi
