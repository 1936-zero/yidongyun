#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SH="$SCRIPT_DIR/scripts/install.sh"

missing=0

assert_install_dep() {
  local label="$1"
  local pkg="$2"

  if ! grep -Eq "install_pkg_any \"${label}\" .*\\b${pkg}\\b" "$INSTALL_SH"; then
    echo "missing install dependency: ${label} (${pkg})" >&2
    missing=1
  fi
}

assert_install_dep "VA-API runtime" "libva2"
assert_install_dep "VA-API DRM runtime" "libva-drm2"
assert_install_dep "VA-API X11 runtime" "libva-x11-2"
assert_install_dep "Qt SVG" "libqt5svg5"
assert_install_dep "ALSA runtime" "libasound2t64"

if ! grep -Eq "apt-get install .*\\blsb-release\\b" "$INSTALL_SH"; then
  echo "missing base dependency: lsb-release" >&2
  missing=1
fi

exit "$missing"
