#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const corePath = path.join(root, 'lib', 'core.js');
const cliPath = path.join(root, 'bin', 'yidongyun.js');
const serverPath = path.join(root, 'server', 'web-server.js');
const uiPath = path.join(root, 'web', 'index.html');
const dockerfilePath = path.join(root, 'Dockerfile');
const composePath = path.join(root, 'docker-compose.yml');

for (const file of [corePath, serverPath, uiPath, dockerfilePath, composePath]) {
  assert.ok(fs.existsSync(file), `missing required file: ${path.relative(root, file)}`);
}

const core = require(corePath);
for (const name of [
  'loadState',
  'maskState',
  'smsSend',
  'smsLogin',
  'listClouds',
  'getAuth',
  'keepalive',
  'parseArgs',
]) {
  assert.strictEqual(typeof core[name], 'function', `core.${name} must be exported`);
}

const cli = fs.readFileSync(cliPath, 'utf8');
assert.match(cli, /require\(['"]\.\.\/lib\/core['"]\)/, 'CLI must use shared core');

const server = fs.readFileSync(serverPath, 'utf8');
assert.match(server, /require\(['"]\.\.\/lib\/core['"]\)/, 'web server must use shared core');
assert.match(server, /YDY_LEGACY_DISCONNECT/, 'web server must preserve legacy disconnect behavior');

const ui = [
  fs.readFileSync(uiPath, 'utf8'),
  fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'),
].join('\n');
assert.match(ui, /\/api\/sms-send/, 'UI must call sms-send API');
assert.match(ui, /\/api\/keepalive/, 'UI must call keepalive API');
assert.match(ui, /loadCloudCache/, 'UI must load cached cloud list on page refresh');
assert.match(ui, /\/api\/clouds\?refresh=1/, 'cloud list button must refresh and persist cloud cache');
assert.match(ui, /\/api\/scheduler\/start/, 'UI must call persistent scheduler start API');
assert.match(ui, /\/api\/scheduler\/stop/, 'UI must call persistent scheduler stop API');
assert.match(ui, /signalVerdict/, 'UI must show an explicit success verdict');
assert.match(ui, /开始持续保活/, 'UI must expose persistent start button');
assert.match(ui, /停止持续保活/, 'UI must expose persistent stop button');
assert.strictEqual((ui.match(/保持秒数/g) || []).length, 1, 'UI must expose only one duration input');
assert.match(ui, /markSchedulerInputDirty/, 'UI must track unsaved scheduler form edits');
assert.match(ui, /syncSchedulerForm/, 'UI must centralize scheduler form sync');
assert.match(ui, /forceFormSync/, 'UI refresh must not clobber edited scheduler inputs by default');
assert.match(ui, /APP_TIME_ZONE = 'Asia\/Shanghai'/, 'UI must render timestamps in Shanghai time');
assert.match(ui, /5000\)/, 'UI must refresh state/logs every 5 seconds');
assert.match(ui, /failureCount/, 'UI must show consecutive failure count');
assert.match(ui, /lastFailureReason/, 'UI must show latest failure reason');
assert.match(ui, /上次临时失败/, 'UI must explain retrying scheduler state');
assert.match(server, /connectDesktop ret val: 0/, 'server must parse source-aligned success signal');
assert.match(server, /WEB_LOG_FILE/, 'server must persist Web logs to a file');
assert.match(server, /cloudCache/, 'server must persist cloud list cache');
assert.match(server, /refreshCloudCache/, 'server must explicitly refresh cloud cache');
assert.match(server, /Asia\/Shanghai/, 'server must render logs and summaries in Shanghai time');

const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
assert.match(dockerfile, /scripts\/install\.sh/, 'Docker image must reuse existing install script');
assert.match(dockerfile, /YDY_INSTALL_APP=0[\s\S]*bash scripts\/install\.sh/, 'Docker heavy install layer must not depend on app source files');
const installLayerIndex = dockerfile.indexOf('YDY_INSTALL_APP=0');
const appCopyIndex = dockerfile.indexOf('COPY . /app');
assert.ok(installLayerIndex !== -1 && appCopyIndex !== -1 && installLayerIndex < appCopyIndex, 'Dockerfile must copy app source only after the heavy install layer');
for (const appSource of ['COPY lib/core.js', 'COPY bin/yidongyun.js', 'COPY server', 'COPY web']) {
  const sourceIndex = dockerfile.indexOf(appSource);
  assert.ok(sourceIndex === -1 || sourceIndex > installLayerIndex, `${appSource} must not invalidate the heavy Docker install layer`);
}
assert.match(fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8'), /\/usr\/local\/lib\/yidongyun/, 'installer must install shared core for global CLI');
assert.match(fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8'), /YDY_INSTALL_APP/, 'installer must support dependency-only Docker builds');

const compose = fs.readFileSync(composePath, 'utf8');
assert.match(compose, /privileged:\s*true/, 'compose file must run privileged to match Ubuntu VM SDK expectations');
assert.match(compose, /network_mode:\s*host/, 'compose file must use host networking for the desktop SDK path');
assert.match(compose, /uts:\s*host/, 'compose file must use the host UTS namespace so SDK sees the Ubuntu VM hostname');
assert.match(compose, /PORT:\s*"\$\{YDY_WEB_PORT:-18081\}"/, 'compose file must bind the web server directly on YDY_WEB_PORT in host network mode');
assert.match(compose, /TZ:\s*Asia\/Shanghai/, 'compose file must set the container timezone');
assert.match(compose, /\/etc\/yidongyun:\/data/, 'compose file must reuse host login state as container YDY_HOME');
assert.match(compose, /\/var\/log\/yidongyun:\/var\/log\/yidongyun/, 'compose file must expose the same legacy log path');
