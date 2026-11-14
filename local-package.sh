#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="dir"
WITH_JRE=0
for arg in "$@"; do
  case "$arg" in
    --dir) MODE="dir" ;;
    --dist) MODE="dist" ;;
    --with-jre) WITH_JRE=1 ;;
    --help|-h)
      cat <<'EOF'
Usage: ./local-package.sh [--dir|--dist] [--with-jre]

  --dir       Build an unpacked app directory (default, no signing)
  --dist      Build an installer for the current OS
  --with-jre  Bundle the local JAVA_HOME into resources/jre first
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -d node_modules ]; then
  echo "[local-package] Installing dependencies…"
  npm ci
fi

echo "[local-package] Building frontend, server, and Electron main…"
npm run desktop:build

if [ "$WITH_JRE" = "1" ]; then
  echo "[local-package] Bundling JRE…"
  npm run desktop:prepare
fi

export CSC_IDENTITY_AUTO_DISCOVERY=false

if [ "$MODE" = "dist" ]; then
  echo "[local-package] Building installer for this OS…"
  case "$(uname -s)" in
    Darwin) npx electron-builder --mac dmg --publish never ;;
    Linux) npx electron-builder --linux AppImage --publish never ;;
    MINGW*|MSYS*) npx electron-builder --win nsis --publish never ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
else
  echo "[local-package] Building unpacked app directory…"
  npx electron-builder --dir --publish never
fi

echo
echo "[local-package] Done."
echo "Output: $ROOT/release"
