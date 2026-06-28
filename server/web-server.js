#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

process.env.YDY_LEGACY_DISCONNECT = process.env.YDY_LEGACY_DISCONNECT || '1';

const {
  getPaths,
  loadState,
  maskState,
  smsSend,
  smsLogin,
  listClouds,
  keepalive,
} = require('../lib/core');

const ROOT = path.join(__dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 8080);
const CONFIG_FILE = process.env.YDY_WEB_CONFIG || path.join(process.env.YDY_HOME || '/data', 'web-config.json');
const LEGACY_LOG_FILE = process.env.YDY_LEGACY_LOG || '/var/log/yidongyun/keepalive-legacy.log';
const WEB_LOG_FILE = process.env.YDY_WEB_LOG || '/var/log/yidongyun/web.log';
const APP_TIME_ZONE = process.env.YDY_TIME_ZONE || 'Asia/Shanghai';

const logLines = [];
const successSignals = [
  { key: 'start', label: 'keepalive start', pattern: /keepalive start/ },
  { key: 'auth', label: 'auth ok', pattern: /auth ok/ },
  { key: 'connectSent', label: 'connected command sent', pattern: /connected command sent; holding \d+s/ },
  { key: 'desktopConnect', label: 'connectDesktop ret val: 0', pattern: /connectDesktop ret val:\s+0/ },
  { key: 'legacyDisconnect', label: 'disconnect callback iCode: -3', pattern: /disconnect callback\s+iCode:\s+-3/ },
  { key: 'desktopDisconnect', label: 'disconnectDesktop ret val: 0', pattern: /disconnectDesktop ret val:\s+0/ },
  { key: 'end', label: 'keepalive end', pattern: /keepalive end/ },
];
const runState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: '',
  currentRunId: 0,
  cancelled: false,
};
let schedulerTimer = null;
let runAbortController = null;
let scheduler = loadScheduler();

function nowIso() {
  return new Date().toISOString();
}

function formatDateTimeParts(value, options) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    hour12: false,
    ...options,
  }).format(new Date(value));
}

function formatLogTime(value = new Date()) {
  return formatDateTimeParts(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatClockTime(value = new Date()) {
  return formatDateTimeParts(value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function appendWebLog(text) {
  try {
    fs.mkdirSync(path.dirname(WEB_LOG_FILE), { recursive: true });
    fs.appendFileSync(WEB_LOG_FILE, `${text}\n`);
  } catch {}
}

function log(line) {
  const text = `[${formatLogTime()}] ${String(line).replace(/\n$/, '')}`;
  logLines.push(text);
  while (logLines.length > 500) logLines.shift();
  appendWebLog(text);
  console.log(text);
}

const coreLogger = {
  log,
  error: log,
  write(chunk) {
    for (const line of String(chunk).split(/\n/)) {
      if (line.trim()) log(line);
    }
  },
};

function loadScheduler() {
  try {
    const loaded = { ...createDefaultScheduler(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    if (loaded.enabled && !loaded.startedAt) loaded.startedAt = nowIso();
    if (loaded.lastSuccessAt && loaded.lastVerdict === 'success') loaded.lastSummary = createSuccessSummary(loaded);
    return loaded;
  } catch {
    return createDefaultScheduler();
  }
}

function createDefaultScheduler() {
  return {
    enabled: false,
    userServiceId: '',
    index: 0,
    duration: 120,
    intervalMinutes: 10,
    nextRunAt: null,
    startedAt: null,
    stoppedAt: null,
    successCount: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastVerdict: 'unknown',
    lastSummary: '',
    consecutiveSuccessSince: null,
    consecutiveFailures: 0,
    lastFailureReason: '',
    lastFailureTransient: false,
  };
}

function saveScheduler() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(publicScheduler(), null, 2) + '\n', { mode: 0o600 });
}

function publicScheduler() {
  return {
    enabled: Boolean(scheduler.enabled),
    userServiceId: scheduler.userServiceId || '',
    index: Number(scheduler.index || 0),
    duration: Number(scheduler.duration || 120),
    intervalMinutes: Number(scheduler.intervalMinutes || 10),
    nextRunAt: scheduler.nextRunAt || null,
    startedAt: scheduler.startedAt || null,
    stoppedAt: scheduler.stoppedAt || null,
    successCount: Number(scheduler.successCount || 0),
    lastSuccessAt: scheduler.lastSuccessAt || null,
    lastFailureAt: scheduler.lastFailureAt || null,
    lastVerdict: scheduler.lastVerdict || 'unknown',
    lastSummary: scheduler.lastSummary || '',
    consecutiveSuccessSince: scheduler.consecutiveSuccessSince || null,
    consecutiveFailures: Number(scheduler.consecutiveFailures || 0),
    lastFailureReason: scheduler.lastFailureReason || '',
    lastFailureTransient: Boolean(scheduler.lastFailureTransient),
  };
}

function mergeSchedulerPatch(current, patch = {}) {
  const wasEnabled = Boolean(current.enabled);
  const next = {
    ...createDefaultScheduler(),
    ...current,
    enabled: Boolean(patch.enabled),
    userServiceId: patch.userServiceId || current.userServiceId || '',
    index: Number(patch.index ?? current.index ?? 0),
    duration: Number(patch.duration || current.duration || 120),
    intervalMinutes: Number(patch.intervalMinutes || current.intervalMinutes || 10),
  };
  if (next.enabled && !wasEnabled) {
    next.startedAt = nowIso();
    next.stoppedAt = null;
    next.successCount = 0;
    next.lastSuccessAt = null;
    next.lastFailureAt = null;
    next.lastVerdict = 'running';
    next.lastSummary = '';
    next.consecutiveSuccessSince = null;
    next.consecutiveFailures = 0;
    next.lastFailureReason = '';
    next.lastFailureTransient = false;
  }
  if (!next.enabled && wasEnabled) {
    next.stoppedAt = nowIso();
    next.nextRunAt = null;
    next.lastVerdict = 'stopped';
  }
  return next;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function createSuccessSummary(source = scheduler) {
  if (!source.lastSuccessAt) return '';
  const since = source.consecutiveSuccessSince || source.startedAt || source.lastSuccessAt;
  const elapsed = new Date(source.lastSuccessAt).getTime() - new Date(since).getTime();
  return `[${formatClockTime(source.lastSuccessAt)}] [${Number(source.successCount || 0)}] 保活成功: ${formatElapsed(elapsed)}`;
}

function errorText(err) {
  const cause = err?.cause || {};
  return [
    err?.message,
    err?.code,
    cause.message,
    cause.code,
    cause.errno,
    cause.syscall,
  ].filter(Boolean).join(' ');
}

function isTransientFailure(err) {
  return /(fetch failed|EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|network|socket|timeout)/i.test(errorText(err));
}

function applyRunSuccess(current, runStartedAt, runFinishedAt = nowIso()) {
  const next = { ...createDefaultScheduler(), ...current };
  const keepExistingStreak = next.lastVerdict === 'success' && next.consecutiveSuccessSince;
  next.successCount = Number(next.successCount || 0) + 1;
  next.lastSuccessAt = runFinishedAt;
  next.lastFailureAt = null;
  next.lastVerdict = 'success';
  next.consecutiveSuccessSince = keepExistingStreak ? next.consecutiveSuccessSince : (runStartedAt || next.startedAt || runFinishedAt);
  next.consecutiveFailures = 0;
  next.lastFailureReason = '';
  next.lastFailureTransient = false;
  next.lastSummary = createSuccessSummary(next);
  return next;
}

function applyRunFailure(current, err) {
  const next = { ...createDefaultScheduler(), ...current };
  const transient = isTransientFailure(err);
  next.lastFailureAt = nowIso();
  next.consecutiveFailures = Number(next.consecutiveFailures || 0) + 1;
  next.lastFailureReason = err.message || String(err);
  next.lastFailureTransient = transient;
  if (transient) {
    next.lastVerdict = 'retrying';
    next.consecutiveSuccessSince = null;
    next.lastSummary = `[${formatClockTime(next.lastFailureAt)}] [失败 ${next.consecutiveFailures}] 保活临时失败，将继续重试: ${next.lastFailureReason}`;
    return next;
  }
  next.lastVerdict = 'failed';
  next.consecutiveSuccessSince = null;
  next.lastSummary = `[${formatClockTime(next.lastFailureAt)}] [失败 ${next.consecutiveFailures}] 保活失败，已自动停止: ${next.lastFailureReason}`;
  next.enabled = false;
  next.nextRunAt = null;
  next.stoppedAt = nowIso();
  return next;
}

function clearSchedulerTimer() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;
}

function resolveStartupDelay(source = scheduler, nowMs = Date.now()) {
  if (!source.enabled) return null;
  const nextRunMs = Date.parse(source.nextRunAt || '');
  if (!Number.isFinite(nextRunMs)) return 0;
  return Math.max(0, nextRunMs - nowMs);
}

function intervalMs(source = scheduler) {
  return Math.max(1, Number(source.intervalMinutes || 10)) * 60 * 1000;
}

function resolveFollowupDelay(source = scheduler, runStartedAt, nowMs = Date.now()) {
  if (!source.enabled) return null;
  const startedMs = Date.parse(runStartedAt || '');
  const baseMs = Number.isFinite(startedMs) ? startedMs : nowMs;
  const nextMs = baseMs + intervalMs(source);
  return {
    delayMs: Math.max(0, nextMs - nowMs),
    nextRunAt: new Date(nextMs).toISOString(),
  };
}

function scheduleNext(delayMs) {
  clearSchedulerTimer();
  if (!scheduler.enabled) {
    scheduler.nextRunAt = null;
    saveScheduler();
    return;
  }
  const waitMs = delayMs ?? intervalMs(scheduler);
  scheduler.nextRunAt = new Date(Date.now() + waitMs).toISOString();
  saveScheduler();
  schedulerTimer = setTimeout(async () => {
    try {
      await runPersistentKeepalive(publicScheduler());
    } catch (err) {
      log(`scheduled keepalive failed: ${err.stack || err.message}`);
    }
  }, waitMs);
}

function scheduleFollowup(runStartedAt) {
  const next = resolveFollowupDelay(scheduler, runStartedAt);
  if (!next) return;
  clearSchedulerTimer();
  scheduler.nextRunAt = next.nextRunAt;
  saveScheduler();
  schedulerTimer = setTimeout(async () => {
    try {
      await runPersistentKeepalive(publicScheduler());
    } catch (err) {
      log(`scheduled keepalive failed: ${err.stack || err.message}`);
    }
  }, next.delayMs);
}

async function runKeepalive(body = {}, opts = {}) {
  if (runState.running) throw new Error('keepalive is already running');
  runState.running = true;
  runState.cancelled = false;
  runState.currentRunId += 1;
  runState.lastStartedAt = nowIso();
  runState.lastError = '';
  runAbortController = new AbortController();
  log('keepalive start');
  try {
    const result = await keepalive({
      userServiceId: body.userServiceId || undefined,
      index: body.index ?? 0,
      duration: body.duration || 120,
    }, { logger: coreLogger, print: false, signal: runAbortController.signal });
    runState.lastFinishedAt = nowIso();
    log('keepalive end');
    if (opts.countSuccess) {
      scheduler = applyRunSuccess(scheduler, runState.lastStartedAt, runState.lastFinishedAt);
      log(scheduler.lastSummary);
      saveScheduler();
    }
    return result;
  } catch (err) {
    runState.lastError = err.message;
    if (err.message === 'operation cancelled') {
      runState.cancelled = true;
      scheduler.lastVerdict = 'cancelled';
      log('keepalive cancelled');
    } else if (opts.countSuccess) {
      scheduler = applyRunFailure(scheduler, err);
      saveScheduler();
    }
    log(`keepalive error: ${err.stack || err.message}`);
    throw err;
  } finally {
    runState.running = false;
    runAbortController = null;
  }
}

async function runPersistentKeepalive(body = {}) {
  clearSchedulerTimer();
  let runStartedAt = null;
  try {
    const result = await runKeepalive({ ...publicScheduler(), ...body }, { countSuccess: true });
    runStartedAt = runState.lastStartedAt;
    return result;
  } finally {
    if (scheduler.enabled) scheduleFollowup(runStartedAt || runState.lastStartedAt);
  }
}

function cancelCurrentRun() {
  if (!runState.running || !runAbortController) return false;
  runAbortController.abort();
  return true;
}

function startPersistentScheduler(body = {}) {
  scheduler = mergeSchedulerPatch(scheduler, { ...body, enabled: true });
  saveScheduler();
  scheduleNext(runState.running ? undefined : 0);
  return publicScheduler();
}

function resumePersistentScheduler() {
  const delay = resolveStartupDelay(scheduler);
  if (delay === null) return;
  scheduleNext(delay);
  log(`persistent scheduler resumed; next run ${scheduler.nextRunAt}`);
}

function stopPersistentScheduler({ cancelCurrent = true } = {}) {
  scheduler = mergeSchedulerPatch(scheduler, { enabled: false });
  clearSchedulerTimer();
  scheduler.nextRunAt = null;
  saveScheduler();
  const cancelled = cancelCurrent ? cancelCurrentRun() : false;
  return { scheduler: publicScheduler(), cancelled };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid json body'));
      }
    });
  });
}

function readTail(file, maxBytes = 64 * 1024) {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const size = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function tailLines(text, limit = 200) {
  return String(text || '').trimEnd().split(/\n/).filter(Boolean).slice(-limit);
}

function lastRunBlock(logText) {
  const text = String(logText || '');
  const idx = text.lastIndexOf('keepalive start');
  if (idx === -1) return text;
  const lineStart = text.lastIndexOf('\n', idx);
  return text.slice(lineStart === -1 ? 0 : lineStart + 1);
}

function analyzeSuccessSignals(logText) {
  const block = lastRunBlock(logText);
  const checks = successSignals.map((signal) => ({
    key: signal.key,
    label: signal.label,
    ok: signal.pattern.test(block),
  }));
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);
  const failureMatch = block.match(/(密码错误[^\n]+|账号将锁定[^\n]*|SDK connect failed:[^\n]+|error while loading shared libraries:[^\n]+|missing SDK:[^\n]+|get auth failed:[^\n]+|fetch failed[^\n]*|keepalive error:[^\n]+)/);
  const hasStart = /keepalive start/.test(block);
  const hasEnd = /keepalive end/.test(block);
  let verdict = 'unknown';
  let reason = '尚未看到完整保活日志';

  if (failureMatch) {
    verdict = 'failed';
    reason = failureMatch[1] || failureMatch[0];
  } else if (hasStart && !hasEnd) {
    verdict = 'running';
    reason = '本轮保活正在运行或等待保持时间结束';
  } else if (missing.length === 0) {
    verdict = 'success';
    reason = '最近一轮日志包含所有源码定义的连接成功信号';
  } else if (hasEnd) {
    verdict = 'incomplete';
    reason = `最近一轮结束但缺少：${missing.join('、')}`;
  }

  return { verdict, reason, checks, missing };
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, 200, {
        ok: true,
        state: maskState(loadState()),
        paths: getPaths(),
        run: runState,
        scheduler: publicScheduler(),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const legacy = readTail(LEGACY_LOG_FILE);
      const webLog = readTail(WEB_LOG_FILE);
      const web = webLog ? tailLines(webLog) : logLines.slice(-200);
      return sendJson(res, 200, {
        ok: true,
        web,
        legacy,
        signal: analyzeSuccessSignals(`${legacy}\n${web.join('\n')}`),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/clouds') {
      const list = await listClouds({ logger: coreLogger, print: false });
      return sendJson(res, 200, { ok: true, list });
    }
    if (req.method === 'POST' && url.pathname === '/api/sms-send') {
      const body = await readBody(req);
      const response = await smsSend(body.phone, { logger: coreLogger, print: false });
      return sendJson(res, 200, { ok: true, response });
    }
    if (req.method === 'POST' && url.pathname === '/api/sms-login') {
      const body = await readBody(req);
      const result = await smsLogin(body.phone, body.code, { logger: coreLogger, print: false });
      return sendJson(res, result.ok ? 200 : 400, { ok: result.ok, response: result.response });
    }
    if (req.method === 'POST' && url.pathname === '/api/keepalive') {
      const body = await readBody(req);
      const result = scheduler.enabled ? await runPersistentKeepalive(body) : await runKeepalive(body);
      return sendJson(res, 200, { ok: true, result, run: runState, scheduler: publicScheduler() });
    }
    if (req.method === 'POST' && url.pathname === '/api/keepalive/cancel') {
      return sendJson(res, 200, { ok: true, cancelled: cancelCurrentRun(), run: runState });
    }
    if (req.method === 'POST' && url.pathname === '/api/scheduler/start') {
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, scheduler: startPersistentScheduler(body) });
    }
    if (req.method === 'POST' && url.pathname === '/api/scheduler/stop') {
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, ...stopPersistentScheduler(body) });
    }
    if (req.method === 'POST' && url.pathname === '/api/scheduler') {
      const body = await readBody(req);
      scheduler = mergeSchedulerPatch(scheduler, body);
      if (scheduler.enabled) scheduleNext();
      else stopPersistentScheduler({ cancelCurrent: false });
      return sendJson(res, 200, { ok: true, scheduler: publicScheduler() });
    }
    return sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.normalize(path.join(WEB_ROOT, pathname));
  if (!target.startsWith(WEB_ROOT)) return sendText(res, 403, 'forbidden');
  fs.readFile(target, (err, data) => {
    if (err) return sendText(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': contentType(target),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  });
}

resumePersistentScheduler();

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => {
    log(`web ui listening on http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  createServer,
  runKeepalive,
  runPersistentKeepalive,
  publicScheduler,
  analyzeSuccessSignals,
  createDefaultScheduler,
  mergeSchedulerPatch,
  resolveStartupDelay,
  resolveFollowupDelay,
  formatElapsed,
  formatClockTime,
  formatLogTime,
  createSuccessSummary,
  applyRunSuccess,
  applyRunFailure,
  isTransientFailure,
};
