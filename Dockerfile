# syntax=docker/dockerfile:1.7
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=8080 \
    YDY_HOME=/data \
    YDY_CLIENT_ROOT=/opt/yidongyun/client/opt/chuanyun-vdi-client \
    YDY_LEGACY_DISCONNECT=1 \
    QT_QPA_PLATFORM=offscreen

WORKDIR /app

COPY scripts/install.sh /app/scripts/install.sh

RUN --mount=type=cache,target=/opt/yidongyun/cache \
  YDY_INSTALL_APP=0 YDY_CLEAN_APT=1 bash scripts/install.sh \
  && mkdir -p /data /var/log/yidongyun \
  && chmod 700 /data

COPY . /app

RUN install -d -m 0755 /usr/local/lib/yidongyun \
  && install -m 0644 /app/lib/core.js /usr/local/lib/yidongyun/core.js \
  && install -m 0755 /app/bin/yidongyun.js /usr/local/bin/yidongyun

EXPOSE 8080
VOLUME ["/data", "/var/log/yidongyun"]

CMD ["node", "server/web-server.js"]
