#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/yidongyun}"
DEB_URL="${DEB_URL:-https://dl.soho.komect.com/upgrade/download/app/ad2bcdde85d84d6a}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$INSTALL_DIR/cache"
CLIENT_DIR="$INSTALL_DIR/client"
DEB_FILE="$CACHE_DIR/CMCC-JTYDN-UOSx86-2.23.1.deb"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行：sudo bash scripts/install.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  dpkg \
  nodejs \
  libqt5multimedia5 \
  libqt5xml5t64 \
  libqt5printsupport5t64 \
  libqt5concurrent5t64 \
  libjpeg62 \
  dmidecode

mkdir -p "$CACHE_DIR" "$CLIENT_DIR" /etc/yidongyun /var/log/yidongyun
chmod 700 /etc/yidongyun

if [[ ! -s "$DEB_FILE" ]]; then
  curl -L "$DEB_URL" -o "$DEB_FILE"
fi

rm -rf "$CLIENT_DIR"
mkdir -p "$CLIENT_DIR"
dpkg-deb -x "$DEB_FILE" "$CLIENT_DIR"

install -m 0755 "$REPO_DIR/bin/yidongyun.js" /usr/local/bin/yidongyun

echo "安装完成。下一步："
echo "  yidongyun sms-send <手机号>"
echo "  yidongyun sms-login <手机号> <验证码>"
echo "  yidongyun list"
echo "  sudo bash scripts/install-systemd.sh <userServiceId>"
