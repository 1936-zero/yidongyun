# Ubuntu VM legacy keepalive

本文档记录当前已验证的移动云电脑保活方案，并整理为可复制部署流程。

## 结论

推荐部署形态：

```text
飞牛 NAS
  └── Ubuntu x86_64 虚拟机
        └── yidongyun legacy cron 保活
```

不推荐部署形态：

```text
飞牛 NAS / FnOS / Debian 宿主系统
  └── 直接运行 yidongyun
```

实测中，FnOS / Debian 宿主系统可以完成 SDK 认证和连接，日志也会出现 `connectDesktop ret val: 0`，但移动云电脑仍会在空闲倒计时后关机。Ubuntu VM legacy 模式可以复现已验证稳定的旧服务器行为。

## 原理

移动云电脑的保活不是简单调用业务 API，也不是只建立 TCP 连接。需要通过官方 Linux 客户端组件完成一条远程桌面连接链路：

```text
SOHO/CEM API
  -> SCG 网关连接参数
  -> Chuanyun / ZTE SDK
  -> bootCypc
  -> uSmartView_VDI_Client
  -> SPICE 远程桌面会话
```

本方案调用官方客户端解包后的 SDK：

```text
bootCypc
uSmartView_VDI_Client
libspice-client-*
```

每 10 分钟连接一次，每次保持 120 秒。断开时使用 legacy disconnect 行为，以复现已验证稳定的旧 Ubuntu VM 环境。

legacy disconnect 行为由环境变量控制：

```text
YDY_LEGACY_DISCONNECT=1
```

启用后，断连消息会使用旧方案中的占位字段。这个行为会导致 SDK 日志出现 `12220014` 断连回调警告，但当前验证结果表明，这个模式更接近已稳定运行的旧服务器方案。

## 为什么不用 FnOS 宿主直接跑

已验证结果：

```text
Ubuntu VM legacy：
  能持续保活，超过 40 分钟空闲关机窗口后仍在线。

FnOS / Debian 宿主：
  SDK 返回 connectDesktop ret val: 0，但云电脑仍在 30-40 分钟后关机。
```

已排除的问题：

```text
bootCypc 二进制不一致：已排除，hash 一致。
uSmartView_VDI_Client 二进制不一致：已排除，hash 一致。
依赖缺失：未发现关键 not found。
断连逻辑不同：已在 NAS 宿主改成旧逻辑后测试，仍然不能保活。
```

因此更可能的差异在运行环境层：Ubuntu VM 的图形、DMI、KVM/QEMU、运行时和官方客户端预期更接近；FnOS 宿主虽然能连上，但没有被移动云平台识别为有效桌面使用会话。

## 系统要求

Ubuntu VM 推荐条件：

```text
架构：x86_64
系统：Ubuntu 20.04 或更新版本
权限：root / sudo
Node.js：18 或更新版本
网络：能访问 https://soho.komect.com
```

## 安装步骤

进入 Ubuntu VM：

```bash
git clone git@github.com:gjz518/yidongyun.git
cd yidongyun
sudo bash scripts/install.sh
```

短信登录：

```bash
sudo yidongyun sms-send <手机号>
sudo yidongyun sms-login <手机号> <短信验证码>
```

查看云电脑列表：

```bash
sudo yidongyun list
```

输出示例：

```text
0: userServiceId=1234567 vmName=青藤 spuCode=zte-cloud-pc
```

启用 legacy cron 保活：

```bash
sudo bash scripts/enable-ubuntu-vm-legacy.sh <userServiceId>
```

手动测试一次：

```bash
sudo /usr/local/bin/yidongyun-keepalive-legacy.sh
```

## 验证

查看 cron：

```bash
cat /etc/cron.d/yidongyun-keepalive-legacy
```

应看到：

```cron
*/10 * * * * root /usr/local/bin/yidongyun-keepalive-legacy.sh
```

查看日志：

```bash
tail -n 100 /var/log/yidongyun/keepalive-legacy.log
```

成功日志应包含：

```text
keepalive start
auth ok
connected command sent; holding 120s
connectDesktop ret val: 0
disconnect callback  iCode: -3
disconnectDesktop ret val: 0
keepalive end
```

`disconnect callback iCode: -3` 和 `12220014` 是 legacy disconnect 模式下的预期现象，不单独视为失败。

## 运行状态检查

在 Ubuntu VM 中：

```bash
grep yidongyun-keepalive-legacy /etc/cron.d/yidongyun-keepalive-legacy
tail -n 100 /var/log/yidongyun/keepalive-legacy.log
```

在移动云电脑中：

```bash
uptime
uptime -s
last -x reboot shutdown | head
```

判断标准：

```text
保活日志每 10 分钟出现一次 keepalive start。
每轮日志出现 connectDesktop ret val: 0。
移动云电脑运行时间超过 40 分钟后没有出现新的 shutdown/reboot。
```

## 重装恢复

如果 Ubuntu VM 重装：

```bash
git clone git@github.com:gjz518/yidongyun.git
cd yidongyun
sudo bash scripts/install.sh
sudo yidongyun sms-send <手机号>
sudo yidongyun sms-login <手机号> <短信验证码>
sudo yidongyun list
sudo bash scripts/enable-ubuntu-vm-legacy.sh <userServiceId>
sudo /usr/local/bin/yidongyun-keepalive-legacy.sh
```

如果有本地安全备份，可恢复：

```text
/etc/yidongyun/state.json
/etc/yidongyun/yidongyun.env
```

注意：`state.json` 包含登录 token，不要提交到 GitHub。

## 回滚

停用 legacy cron：

```bash
sudo rm -f /etc/cron.d/yidongyun-keepalive-legacy
```

停止当前正在运行的保活进程：

```bash
pgrep -af 'yidongyun keepalive|bootCypc|uSmartView_VDI_Client'
sudo pkill -f 'yidongyun keepalive|bootCypc|uSmartView_VDI_Client'
```

如需重新启用：

```bash
sudo bash scripts/enable-ubuntu-vm-legacy.sh <userServiceId>
```

## 备份建议

推荐在飞牛 NAS 上保留 Ubuntu VM 的快照或导出镜像。这样 NAS 重装后可以直接导入 VM，再检查 cron 和日志即可恢复保活。

最低限度备份：

```text
/etc/yidongyun/state.json
/etc/yidongyun/yidongyun.env
/etc/cron.d/yidongyun-keepalive-legacy
```

敏感文件只做私有备份，不要公开发布。
