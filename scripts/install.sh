#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/yidongyun}"
DEB_URL="${DEB_URL:-https://dl.soho.komect.com/upgrade/download/app/ad2bcdde85d84d6a}"
YDY_INSTALL_APP="${YDY_INSTALL_APP:-1}"
YDY_CLEAN_APT="${YDY_CLEAN_APT:-0}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$INSTALL_DIR/cache"
CLIENT_DIR="$INSTALL_DIR/client"
DEB_FILE="$CACHE_DIR/CMCC-JTYDN-UOSx86-2.23.1.deb"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行：sudo bash scripts/install.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl dpkg nodejs dmidecode lsb-release

install_pkg_any() {
  local label="$1"
  shift
  local pkg
  for pkg in "$@"; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
      apt-get install -y "$pkg"
      return 0
    fi
  done
  echo "缺少依赖：$label，可尝试手动安装以下任一包：$*" >&2
  return 1
}

install_pkg_any "Qt Multimedia" libqt5multimedia5
install_pkg_any "Qt SVG" libqt5svg5
install_pkg_any "Qt XML" libqt5xml5t64 libqt5xml5
install_pkg_any "Qt PrintSupport" libqt5printsupport5t64 libqt5printsupport5
install_pkg_any "Qt Concurrent" libqt5concurrent5t64 libqt5concurrent5
install_pkg_any "JPEG runtime" libjpeg62 libjpeg62-turbo
install_pkg_any "PulseAudio GLib runtime" libpulse-mainloop-glib0
install_pkg_any "ALSA runtime" libasound2t64 libasound2
install_pkg_any "VA-API runtime" libva2
install_pkg_any "VA-API DRM runtime" libva-drm2
install_pkg_any "VA-API X11 runtime" libva-x11-2

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 版本过低：需要 18+，当前 $(node -v 2>/dev/null || echo unknown)" >&2
  echo "请先安装 Node.js 18 或更新版本后重新执行安装脚本。" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR" "$CLIENT_DIR" /etc/yidongyun /var/log/yidongyun
chmod 700 /etc/yidongyun

if [[ ! -s "$DEB_FILE" ]]; then
  curl -L "$DEB_URL" -o "$DEB_FILE"
fi

rm -rf "$CLIENT_DIR"
mkdir -p "$CLIENT_DIR"
dpkg-deb -x "$DEB_FILE" "$CLIENT_DIR"

if [[ "$YDY_INSTALL_APP" != "0" ]]; then
  install -d -m 0755 /usr/local/lib/yidongyun
  install -m 0644 "$REPO_DIR/lib/core.js" /usr/local/lib/yidongyun/core.js
  install -m 0755 "$REPO_DIR/bin/yidongyun.js" /usr/local/bin/yidongyun
fi

if [[ "$YDY_CLEAN_APT" == "1" ]]; then
  apt-get clean
  rm -rf /var/lib/apt/lists/*
fi

echo "安装完成。下一步："
echo "  yidongyun sms-send <手机号>"
echo "  yidongyun sms-login <手机号> <验证码>"
echo "  yidongyun list"
echo "  sudo bash scripts/install-systemd.sh <userServiceId>"
