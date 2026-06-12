#!/usr/bin/env bash
set -euo pipefail

USER_SERVICE_ID="${1:-}"
DURATION="${DURATION:-120}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行：sudo bash scripts/install-systemd.sh <userServiceId>" >&2
  exit 1
fi

if [[ -z "$USER_SERVICE_ID" ]]; then
  echo "用法：sudo bash scripts/install-systemd.sh <userServiceId>" >&2
  exit 1
fi

mkdir -p /etc/yidongyun /var/log/yidongyun
chmod 700 /etc/yidongyun

cat >/etc/yidongyun/yidongyun.env <<EOF
YDY_HOME=/etc/yidongyun
YDY_CLIENT_ROOT=/opt/yidongyun/client/opt/chuanyun-vdi-client
USER_SERVICE_ID=$USER_SERVICE_ID
DURATION=$DURATION
QT_QPA_PLATFORM=offscreen
EOF
chmod 600 /etc/yidongyun/yidongyun.env

cat >/etc/systemd/system/yidongyun-keepalive.service <<'EOF'
[Unit]
Description=Yidongyun CMCC Cloud PC keepalive
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/yidongyun/yidongyun.env
ExecStart=/usr/local/bin/yidongyun keepalive --user-service-id ${USER_SERVICE_ID} --duration ${DURATION}
EOF

cat >/etc/systemd/system/yidongyun-keepalive.timer <<'EOF'
[Unit]
Description=Run Yidongyun keepalive every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true
Unit=yidongyun-keepalive.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now yidongyun-keepalive.timer
systemctl list-timers yidongyun-keepalive.timer --no-pager
