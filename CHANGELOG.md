# Changelog

## 2026-06-17

### 飞牛 NAS / Debian 12 兼容性更新

本次更新主要针对在飞牛 NAS 上部署和运行时发现的问题做兼容处理。

#### 新增

- README 增加飞牛 NAS / Debian 系统部署前检查说明。
- 安装脚本支持 Debian 12 和 Ubuntu 24.04 的不同 Qt 依赖包名。
- 安装脚本增加 Node.js 版本检查，要求 Node.js 18 或更新版本。

#### 修复

- 修复 Debian 12 上缺少 `libpulse-mainloop-glib.so.0` 导致官方客户端启动失败的问题。
  - 新增依赖：`libpulse-mainloop-glib0`
- 修复断开连接时使用占位参数导致 SDK 日志出现断连警告的问题。
  - `disconnect` 现在复用真实连接参数。

#### 已验证环境

```text
系统：Debian GNU/Linux 12 bookworm
设备：飞牛 NAS
架构：x86_64
Node.js：v22.22.3
systemd：可用
apt：可用
```

#### 验证结果

```text
安装：成功
短信登录：成功
云电脑列表：成功
systemd timer：启用成功
keepalive service：运行完成，退出码 0/SUCCESS
```

#### 注意事项

- ARM / aarch64 设备仍无法直接运行，因为官方 Linux 客户端包是 x86 架构。
- 首次安装会下载官方客户端包，体积约 235 MB。
- 解包后 `/opt/yidongyun` 约占用 1.4 GB。
- 同一个云电脑不建议在多台设备上同时运行定时连接任务。

