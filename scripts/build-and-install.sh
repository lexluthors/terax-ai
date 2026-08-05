#!/usr/bin/env bash
set -euo pipefail

# ═══ 配置 ═══════════════════════════════════════════════
SUDO_PASSWORD="asdf"  # ← 修改为你的 sudo 密码
# ═════════════════════════════════════════════════════════

cd "$(dirname "$0")/.."

# ═══ 自动升级版本号 ═══════════════════════════════════════
echo "▶ 升级版本号..."
# 从 package.json 读取当前版本
CURRENT_VERSION=$(grep '"version":' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "  当前版本: $CURRENT_VERSION"

# 解析版本号 (major.minor.patch) 并递增 patch
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"
echo "  新版本:   $NEW_VERSION"

# 更新所有版本号文件
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
sed -i "s/version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" nix/sources.json

echo "  ✓ 已更新 package.json, tauri.conf.json, Cargo.toml, nix/sources.json"
echo ""
# ══════════════════════════════════════════════════════════

echo "▶ 清理旧的安装残留（防止菜单启动走旧版本）..."
# 删除用户级 desktop 文件（优先级高于系统级，会导致菜单启动走旧版本）
rm -f ~/.local/share/applications/Terax.desktop
rm -f ~/.local/share/applications/terax.desktop
echo "  ✓ 已清理旧 desktop 文件"

echo "▶ 清理旧 deb..."
rm -f src-tauri/target/release/bundle/deb/*.deb

echo "▶ 构建..."
# 禁用 updater 签名（本地开发不需要自动更新签名）
pnpm tauri build -b deb -c '{"bundle":{"createUpdaterArtifacts":false}}'

echo "▶ 安装..."
DEB_FILE=$(ls -t "$(pwd)/src-tauri/target/release/bundle/deb/"[Tt]erax_*.deb | head -1)
echo "$SUDO_PASSWORD" | sudo -S apt install -y --reinstall "$DEB_FILE"

echo ""
echo "✓ 完成！版本 $NEW_VERSION 已安装"
echo ""
echo "现在从菜单启动的 Terax 将是新版本（/usr/bin/terax）"
