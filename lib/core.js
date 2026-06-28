'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.YDY_HOME || '/etc/yidongyun';
const STATE_FILE = process.env.YDY_STATE || path.join(ROOT, 'state.json');
const CLIENT_ROOT = process.env.YDY_CLIENT_ROOT || '/opt/yidongyun/client/opt/chuanyun-vdi-client';
const SDK_ROOT = process.env.YDY_SDK_ROOT || path.join(CLIENT_ROOT, 'resources/app.asar.unpacked/node_modules');
const ZTE_SDK = path.join(SDK_ROOT, 'chuanyunAddOn-zte', 'ccsdk');
const ZTE_BIN = path.join(ZTE_SDK, 'bin');
const ZTE_LIB = path.join(ZTE_SDK, 'lib');
const SOCKET_PATH = process.env.YDY_SOCKET_PATH || '/tmp/my.sock';

const CONFIG = {
  appKey: 'a2c4f80ec311ce63d06a36e269111b505327e0fe9ddb74767e5ef63bc293c5ce',
  appSecretHex: '1ab7eb793c4aeafa5d6b32e4461183eaa16b531ff2b51de14d77c81ff6be8fa6',
  baseUrl: 'https://soho.komect.com',
  version: '2.23.1',
  versionNum: '2230100',
  releaseNum: '1',
  gitNum: '176005e',
};

function getPaths() {
  return { ROOT, STATE_FILE, CLIENT_ROOT, SDK_ROOT, ZTE_SDK, ZTE_BIN, ZTE_LIB, SOCKET_PATH };
}

function createLogger(logger = console) {
  const log = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};
  const error = typeof logger.error === 'function' ? logger.error.bind(logger) : log;
  const write = typeof logger.write === 'function' ? logger.write.bind(logger) : (s) => log(String(s).replace(/\n$/, ''));
  return { log, error, write };
}

function usageText() {
  return `Usage:
  yidongyun sms-send <phone>
  yidongyun sms-login <phone> <code>
  yidongyun list
  yidongyun auth <userServiceId>
  yidongyun keepalive [--user-service-id ID] [--index N] [--duration 120]
  yidongyun state`;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(next) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}

function mergeState(patch) {
  const state = { ...loadState(), ...patch };
  saveState(state);
  return state;
}

function maskState(input = loadState()) {
  const safe = { ...input };
  if (safe.sohoToken) safe.sohoToken = '***';
  if (safe.publicKey) safe.publicKey = '***';
  if (safe.phone) safe.phone = String(safe.phone).replace(/(1[3-9]\d)\d{4}(\d{4})/, '$1****$2');
  return safe;
}

function ymd(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}${dd}`;
}

function randId(len = 32) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function defaultDeviceId() {
  const host = os.hostname() || 'linux';
  const ifaces = os.networkInterfaces();
  let mac = '00:00:00:00:00:00';
  for (const values of Object.values(ifaces)) {
    for (const v of values || []) {
      if (!v.internal && v.mac && v.mac !== '00:00:00:00:00:00') {
        mac = v.mac;
        break;
      }
    }
    if (mac !== '00:00:00:00:00:00') break;
  }
  return `${host}-${mac}`;
}

function createSign(method, url, header, body) {
  const parts = [];
  for (const key of Object.keys(header)) {
    if (header[key]) parts.push(`${key}=${header[key]}`);
  }
  let str = `${method}&${url}&${parts.join('&')}`;
  let encoded = JSON.stringify(body || {});
  if (encoded && encoded !== '{}') {
    if (encoded.includes('{')) {
      encoded = JSON.parse(encoded);
      str += `&body=${encoded.data}`;
    } else {
      str += `&${encoded}`;
    }
  }
  return crypto.createHmac('sha256', Buffer.from(CONFIG.appSecretHex, 'hex')).update(str, 'utf8').digest('hex');
}

function getHeaders(state, url, method, body) {
  const platform = 'Linux';
  const timestamp = String(Date.now());
  const deviceId = state.deviceId || defaultDeviceId();
  const header = {
    'X-SOHO-AppKey': CONFIG.appKey,
    'X-SOHO-AppType': state.appType || `${platform}|${CONFIG.version}|${platform}|-1|-1|${deviceId}|`,
    'X-SOHO-ClientVersion': CONFIG.version,
    'X-SOHO-DeviceId': deviceId,
    'X-SOHO-RomVersion': state.romVersion || `${platform}-${CONFIG.version}`,
    'X-SOHO-SohoToken': state.sohoToken || '',
    'X-SOHO-Timestamp': timestamp,
    'X-SOHO-UserId': state.userId || '',
    'X-SOHO-Uuid': randId(32),
    'X-SOHO-VersionNum': CONFIG.versionNum,
  };
  return {
    ...header,
    'Content-Type': 'application/json',
    'User-Agent': `jtydn-${platform}-${CONFIG.version}(${CONFIG.releaseNum}.${CONFIG.gitNum}.${ymd()})`,
    'X-SOHO-Signature': createSign(method, url, header, body),
  };
}

function rsaEncryptBody(data, publicKeyBody) {
  const raw = Buffer.from(JSON.stringify(data), 'utf8');
  const chunks = [];
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyBody}\n-----END PUBLIC KEY-----`;
  for (let i = 0; i < Math.ceil(raw.length / 117); i++) {
    const part = raw.subarray(i * 117, (i + 1) * 117);
    const padded = Buffer.concat([Buffer.alloc(128 - part.length), part]);
    chunks.push(crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_NO_PADDING }, padded));
  }
  return { data: Buffer.concat(chunks).toString('base64') };
}

async function api(url, data, opts = {}) {
  const state = loadState();
  let body;
  if (data) {
    if (!state.publicKey) throw new Error('missing publicKey; run init or sms-send first');
    body = rsaEncryptBody(data, state.publicKey);
  }
  const method = opts.method || 'POST';
  const fullUrl = `${CONFIG.baseUrl}/terminal${url}`;
  let res;
  try {
    res = await fetch(fullUrl, {
      method,
      headers: getHeaders(state, url, method, body),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const cause = err.cause || {};
    const detail = [
      cause.code,
      cause.syscall,
      cause.hostname || cause.host,
      cause.address,
      cause.port,
      cause.message,
    ].filter(Boolean).join(' ');
    const wrapped = new Error(`fetch failed: ${fullUrl}${detail ? ` (${detail})` : ''}`);
    wrapped.cause = err;
    throw wrapped;
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`non-json response ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`http ${res.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function ensurePublicKey() {
  const state = loadState();
  if (state.publicKey) return state.publicKey;
  const d = await api('/login/encryptKey/v1', null);
  if (d.code !== 2000) throw new Error(`public key failed: ${JSON.stringify(d)}`);
  mergeState({ publicKey: d.data, deviceId: state.deviceId || defaultDeviceId() });
  return d.data;
}

async function smsSend(phone, opts = {}) {
  const logger = createLogger(opts.logger);
  if (!phone) throw new Error('missing phone');
  await ensurePublicKey();
  const d = await api('/login/sms/send/v1', { phone });
  if (opts.print !== false) logger.log(JSON.stringify(d, null, 2));
  return d;
}

async function smsLogin(phone, smsCode, opts = {}) {
  const logger = createLogger(opts.logger);
  if (!phone || !smsCode) throw new Error('usage: yidongyun sms-login <phone> <code>');
  await ensurePublicKey();
  const d = await api('/login/sms/login/v1', { phone, smsCode });
  if (d.code !== 2000) {
    if (opts.print !== false) logger.log(JSON.stringify(d, null, 2));
    return { ok: false, response: d };
  }
  const u = d.data || {};
  mergeState({
    userId: u.userId,
    nickname: u.nickname || '',
    phone: u.phone || phone,
    sohoToken: u.sohoToken,
    username: u.username,
    isLogined: true,
  });
  if (opts.print !== false) logger.log('login ok');
  return { ok: true, response: d };
}

async function listClouds(opts = {}) {
  const logger = createLogger(opts.logger);
  const d = await api('/cc/cloudPc/list/v6', { pageNum: 1 });
  if (d.code !== 2000) {
    if (opts.print !== false) logger.log(JSON.stringify(d, null, 2));
    return [];
  }
  const list = d.data?.list || [];
  if (opts.print !== false) {
    list.forEach((it, i) => {
      logger.log(`${i}: userServiceId=${it.userServiceId} vmName=${it.vmName || it.cloudPcName || ''} spuCode=${it.spuCode || ''} sku=${it.skuName || ''}`);
    });
  }
  return list;
}

async function getAuth(userServiceId) {
  const d = await api('/cc/getFirmAuth/v1', { userServiceId });
  if (d.code !== 2000) throw new Error(`get auth failed: ${JSON.stringify(d)}`);
  return d.data;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('operation cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('operation cancelled'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function redactLog(input) {
  return String(input)
    .replace(/("vmPassword"\s*:\s*")[^"]+/g, '$1***')
    .replace(/(vmpsswd:\s*)\S+/g, '$1***')
    .replace(/(userName:\s*)1[3-9]\d{9}/g, '$1***')
    .replace(/1[3-9]\d{3}\d{4}(\d{4})/g, '1********$1');
}

function startZteSdk(opts = {}) {
  const logger = createLogger(opts.logger);
  if (!fs.existsSync(path.join(ZTE_BIN, 'bootCypc'))) {
    throw new Error(`missing SDK: ${ZTE_BIN}`);
  }
  fs.mkdirSync(path.join(ZTE_SDK, 'log'), { recursive: true });
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  const child = spawn(path.join(ZTE_BIN, 'bootCypc'), [], {
    cwd: ZTE_BIN,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${ZTE_LIB}:${process.env.LD_LIBRARY_PATH || ''}`,
      QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || 'offscreen',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logger.write(`[bootCypc] ${redactLog(d)}`));
  child.stderr.on('data', (d) => logger.write(`[bootCypc] ${redactLog(d)}`));
  child.on('exit', (code, sig) => logger.log(`bootCypc exited code=${code} sig=${sig || ''}`));
  return child;
}

function connectSocket(onData) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const deadline = Date.now() + 15000;
    function tryConnect() {
      client.connect(SOCKET_PATH, () => resolve(client));
    }
    client.on('data', (data) => {
      for (const chunk of String(data).split('}')) {
        if (!chunk.trim()) continue;
        try { onData(JSON.parse(`${chunk}}`)); } catch {}
      }
    });
    client.on('error', (err) => {
      if (Date.now() > deadline) reject(err);
      else setTimeout(tryConnect, 500);
    });
    tryConnect();
  });
}

async function keepalive(opts = {}, runOpts = {}) {
  const logger = createLogger(runOpts.logger);
  const signal = runOpts.signal;
  if (signal?.aborted) throw new Error('operation cancelled');
  let userServiceId = opts.userServiceId;
  if (!userServiceId) {
    const clouds = await listClouds({ logger, print: runOpts.print });
    const idx = Number(opts.index || 0);
    userServiceId = clouds[idx]?.userServiceId;
  }
  if (!userServiceId) throw new Error('no userServiceId found');
  const auth = await getAuth(userServiceId);
  logger.log(`auth ok: vmId=${auth.vmId} spuCode=${auth.spuCode || ''}`);
  if (!String(auth.spuCode || '').includes('zte-')) {
    throw new Error(`only zte SDK path is implemented in this CLI now; spuCode=${auth.spuCode || ''}`);
  }
  let child;
  let client;
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try { client?.write(JSON.stringify({ command: 'exit' })); } catch {}
    try { client?.end(); } catch {}
    try { child?.kill('SIGTERM'); } catch {}
  }
  function onAbort() {
    cleanup();
  }
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const events = [];
  let failConnection;
  const connectionFailure = new Promise((_, reject) => {
    failConnection = reject;
  });
  try {
    child = startZteSdk({ logger });
    client = await connectSocket((d) => {
      events.push(d);
      logger.log(`[event] ${JSON.stringify(d)}`);
      if (d.command === 'connect' && Number(d.iCode) < 0) {
        failConnection(new Error(`SDK connect failed: ${d.msg || JSON.stringify(d)}`));
      }
    });
    if (signal?.aborted) throw new Error('operation cancelled');
    const msg = {
      command: 'connect',
      vmUserName: auth.vmUserName,
      vmPassword: auth.vmPassword,
      vmID: auth.vmId,
      vmcIP: auth.vmcIp,
      vmcPort: auth.vmcPort,
      cagIP: auth.cagIp,
      cagPort: auth.cagPort,
    };
    client.write(JSON.stringify(msg));
    const duration = Number(opts.duration || 120);
    logger.log(`connected command sent; holding ${duration}s`);
    await Promise.race([wait(duration * 1000, signal), connectionFailure]);
    const disconnectMsg = process.env.YDY_LEGACY_DISCONNECT === '1'
      ? { command: 'disconnect', vmID: auth.vmId, vmUserName: '1', vmPassword: '2', vmcIP: '3', vmcPort: 4, cagIP: '5', cagPort: 6 }
      : { ...msg, command: 'disconnect' };
    client.write(JSON.stringify(disconnectMsg));
    await wait(3000, signal);
    cleanup();
    return { userServiceId, vmId: auth.vmId, events };
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
    cleanup();
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[i + 1];
      i++;
    } else {
      out._.push(a);
    }
  }
  return out;
}

module.exports = {
  CONFIG,
  getPaths,
  usageText,
  loadState,
  saveState,
  mergeState,
  maskState,
  ymd,
  randId,
  defaultDeviceId,
  createSign,
  getHeaders,
  rsaEncryptBody,
  api,
  ensurePublicKey,
  smsSend,
  smsLogin,
  listClouds,
  getAuth,
  wait,
  redactLog,
  startZteSdk,
  connectSocket,
  keepalive,
  parseArgs,
};
