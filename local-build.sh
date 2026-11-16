#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUN_AFTER_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --build-only) RUN_AFTER_BUILD=0 ;;
    --help|-h)
      cat <<'EOF'
用法：./local-build.sh [--build-only]

默认编译前端、服务端和 Electron 主进程，然后直接启动桌面版。
  --build-only  只编译，不启动桌面版。
EOF
      exit 0
      ;;
    *)
      echo "[local-build] 未知参数：$arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "[local-build] 未找到 Node.js，请先安装 Node.js 22.12 或更高版本。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[local-build] 未找到 npm。" >&2
  exit 1
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    console.error(`[local-build] 当前 Node.js ${process.versions.node}，需要 22.12.0 或更高版本。`);
    process.exit(1);
  }
'

if [ ! -f package.json ] || [ ! -f package-lock.json ]; then
  echo "[local-build] 未找到 package.json 或 package-lock.json。" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[local-build] 安装项目依赖…"
  npm ci
fi

echo "[local-build] 编译前端、服务端和 Electron 主进程…"
npm run desktop:build

echo
echo "[local-build] 编译完成。"
echo "[local-build] 前端目录：$ROOT/dist"
echo "[local-build] 服务端目录：$ROOT/dist-server"
echo "[local-build] Electron 目录：$ROOT/dist-desktop"

if [ "$RUN_AFTER_BUILD" = "1" ]; then
  echo "[local-build] 启动桌面版…"
  exec "$ROOT/node_modules/.bin/electron" "$ROOT"
fi
