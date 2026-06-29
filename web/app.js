'use strict';

const $ = (id) => document.getElementById(id);
const APP_TIME_ZONE = 'Asia/Shanghai';

const els = {
  runtimeSummary: $('runtimeSummary'),
  refreshBtn: $('refreshBtn'),
  loginBadge: $('loginBadge'),
  statePhone: $('statePhone'),
  stateUser: $('stateUser'),
  schedulerActive: $('schedulerActive'),
  runActive: $('runActive'),
  nextRun: $('nextRun'),
  successCount: $('successCount'),
  failureCount: $('failureCount'),
  lastFailure: $('lastFailure'),
  phoneInput: $('phoneInput'),
  codeInput: $('codeInput'),
  sendSmsBtn: $('sendSmsBtn'),
  loginBtn: $('loginBtn'),
  listBtn: $('listBtn'),
  cloudList: $('cloudList'),
  userServiceIdInput: $('userServiceIdInput'),
  durationInput: $('durationInput'),
  indexInput: $('indexInput'),
  keepaliveBtn: $('keepaliveBtn'),
  intervalInput: $('intervalInput'),
  startSchedulerBtn: $('startSchedulerBtn'),
  stopSchedulerBtn: $('stopSchedulerBtn'),
  refreshLogsBtn: $('refreshLogsBtn'),
  signalVerdict: $('signalVerdict'),
  signalReason: $('signalReason'),
  signalChecks: $('signalChecks'),
  successSummary: $('successSummary'),
  logOutput: $('logOutput'),
  toast: $('toast'),
};

const schedulerInputs = [
  els.userServiceIdInput,
  els.durationInput,
  els.indexInput,
  els.intervalInput,
];

function markSchedulerInputDirty(event) {
  event.currentTarget.dataset.dirty = '1';
}

function clearSchedulerInputDirty() {
  for (const input of schedulerInputs) {
    delete input.dataset.dirty;
  }
}

function syncSchedulerInput(input, value, { forceFormSync = false } = {}) {
  if (!forceFormSync && (input.dataset.dirty === '1' || document.activeElement === input)) return;
  input.value = value;
}

function syncSchedulerForm(scheduler = {}, options = {}) {
  syncSchedulerInput(els.intervalInput, scheduler.intervalMinutes || 10, options);
  syncSchedulerInput(els.durationInput, scheduler.duration || 120, options);
  syncSchedulerInput(els.indexInput, scheduler.index || 0, options);
  if (scheduler.userServiceId) syncSchedulerInput(els.userServiceIdInput, scheduler.userServiceId, options);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || JSON.stringify(data));
  return data;
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: APP_TIME_ZONE,
    hour12: false,
  });
}

function renderState(data, options = {}) {
  const state = data.state || {};
  const run = data.run || {};
  const scheduler = data.scheduler || {};
  const loggedIn = Boolean(state.isLogined && state.sohoToken);

  els.loginBadge.textContent = loggedIn ? '已登录' : '未登录';
  els.loginBadge.className = `badge ${loggedIn ? 'good' : 'bad'}`;
  els.statePhone.textContent = state.phone || '-';
  els.stateUser.textContent = state.userId || '-';
  els.schedulerActive.textContent = scheduler.enabled ? '已开启' : '已停止';
  els.runActive.textContent = run.running ? '运行中' : '空闲';
  els.nextRun.textContent = formatTime(scheduler.nextRunAt);
  els.successCount.textContent = String(scheduler.successCount || 0);
  els.failureCount.textContent = String(scheduler.consecutiveFailures || 0);
  els.lastFailure.textContent = scheduler.lastFailureReason
    ? `${formatTime(scheduler.lastFailureAt)} ${scheduler.lastFailureReason}`
    : '-';
  syncSchedulerForm(scheduler, options);
  if (scheduler.lastSummary) els.successSummary.textContent = scheduler.lastSummary;
  else els.successSummary.textContent = scheduler.enabled ? '持续保活已开启，等待首次成功记录' : '尚无持续保活成功记录';

  const last = run.lastFinishedAt ? `上次完成 ${formatTime(run.lastFinishedAt)}` : '尚无完成记录';
  const persistent = scheduler.enabled ? '持续保活已开启' : '持续保活已停止';
  const runText = scheduler.lastVerdict === 'retrying'
    ? `上次临时失败，等待 ${formatTime(scheduler.nextRunAt)} 重试`
    : (run.running ? '当前轮运行中' : last);
  els.runtimeSummary.textContent = `${loggedIn ? '状态已登录' : '等待登录'}，${persistent}，${runText}`;
}

function renderClouds(list) {
  if (!list.length) {
    els.cloudList.className = 'table-empty';
    els.cloudList.textContent = '没有读取到云电脑';
    return;
  }
  els.cloudList.className = '';
  els.cloudList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>userServiceId</th>
          <th>名称</th>
          <th>spuCode</th>
          <th>套餐</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${list.map((it, index) => `
          <tr>
            <td>${index}</td>
            <td><code>${it.userServiceId || ''}</code></td>
            <td>${it.vmName || it.cloudPcName || ''}</td>
            <td><code>${it.spuCode || ''}</code></td>
            <td>${it.skuName || ''}</td>
            <td><button type="button" data-service="${it.userServiceId || ''}" data-index="${index}">使用</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  for (const button of els.cloudList.querySelectorAll('button[data-service]')) {
    button.addEventListener('click', () => {
      els.userServiceIdInput.value = button.dataset.service;
      els.indexInput.value = button.dataset.index;
      els.userServiceIdInput.dataset.dirty = '1';
      els.indexInput.dataset.dirty = '1';
      showToast('已填入 userServiceId');
    });
  }
}

function renderSignal(signal = {}) {
  const labels = {
    success: '连接成功',
    running: '运行中',
    retrying: '重试中',
    failed: '连接失败',
    incomplete: '信号不完整',
    unknown: '未验证',
  };
  const verdict = signal.verdict || 'unknown';
  els.signalVerdict.textContent = labels[verdict] || labels.unknown;
  els.signalVerdict.className = `verdict ${verdict}`;
  els.signalReason.textContent = signal.reason || '等待日志分析';
  els.signalChecks.innerHTML = (signal.checks || []).map((check) => `
    <div class="signal-check ${check.ok ? 'ok' : 'missing'}">${check.label}</div>
  `).join('');
}

async function refreshState(options = {}) {
  const data = await api('/api/state');
  renderState(data, options);
}

async function refreshLogs() {
  const data = await api('/api/logs');
  renderSignal(data.signal);
  const web = data.web.length ? data.web.join('\n') : '暂无 Web 运行日志';
  const legacy = data.legacy ? data.legacy.trim() : '暂无 legacy 日志';
  els.logOutput.textContent = `${web}\n\n----- legacy log -----\n${legacy}`;
}

async function loadCloudCache() {
  const data = await api('/api/clouds');
  renderClouds(data.list || []);
}

async function listClouds() {
  setBusy(els.listBtn, true);
  try {
    const data = await api('/api/clouds?refresh=1');
    renderClouds(data.list || []);
    showToast('云电脑列表已更新');
  } finally {
    setBusy(els.listBtn, false);
  }
}

async function sendSms() {
  setBusy(els.sendSmsBtn, true);
  try {
    await api('/api/sms-send', {
      method: 'POST',
      body: JSON.stringify({ phone: els.phoneInput.value.trim() }),
    });
    showToast('验证码已发送');
  } finally {
    setBusy(els.sendSmsBtn, false);
  }
}

async function login() {
  setBusy(els.loginBtn, true);
  try {
    await api('/api/sms-login', {
      method: 'POST',
      body: JSON.stringify({
        phone: els.phoneInput.value.trim(),
        code: els.codeInput.value.trim(),
      }),
    });
    await refreshState();
    showToast('登录成功');
  } finally {
    setBusy(els.loginBtn, false);
  }
}

async function runKeepalive() {
  setBusy(els.keepaliveBtn, true);
  try {
    await api('/api/keepalive', {
      method: 'POST',
      body: JSON.stringify({
        userServiceId: els.userServiceIdInput.value.trim(),
        index: Number(els.indexInput.value || 0),
        duration: Number(els.durationInput.value || 120),
      }),
    });
    await Promise.all([refreshState(), refreshLogs()]);
    showToast('保活运行完成');
  } finally {
    setBusy(els.keepaliveBtn, false);
  }
}

function schedulerPayload() {
  return {
    userServiceId: els.userServiceIdInput.value.trim(),
    index: Number(els.indexInput.value || 0),
    duration: Number(els.durationInput.value || 120),
    intervalMinutes: Number(els.intervalInput.value || 10),
  };
}

async function startScheduler() {
  setBusy(els.startSchedulerBtn, true);
  try {
    await api('/api/scheduler/start', {
      method: 'POST',
      body: JSON.stringify(schedulerPayload()),
    });
    clearSchedulerInputDirty();
    await refreshState({ forceFormSync: true });
    showToast('持续保活已开启');
  } finally {
    setBusy(els.startSchedulerBtn, false);
  }
}

async function stopScheduler() {
  setBusy(els.stopSchedulerBtn, true);
  try {
    await api('/api/scheduler/stop', {
      method: 'POST',
      body: JSON.stringify({ cancelCurrent: true }),
    });
    clearSchedulerInputDirty();
    await Promise.all([refreshState({ forceFormSync: true }), refreshLogs()]);
    showToast('持续保活已停止');
  } finally {
    setBusy(els.stopSchedulerBtn, false);
  }
}

async function guarded(fn) {
  try {
    await fn();
  } catch (err) {
    showToast(err.message);
  }
}

els.refreshBtn.addEventListener('click', () => guarded(async () => {
  await Promise.all([refreshState(), refreshLogs(), loadCloudCache()]);
}));
els.refreshLogsBtn.addEventListener('click', () => guarded(refreshLogs));
els.listBtn.addEventListener('click', () => guarded(listClouds));
els.sendSmsBtn.addEventListener('click', () => guarded(sendSms));
els.loginBtn.addEventListener('click', () => guarded(login));
els.keepaliveBtn.addEventListener('click', () => guarded(runKeepalive));
els.startSchedulerBtn.addEventListener('click', () => guarded(startScheduler));
els.stopSchedulerBtn.addEventListener('click', () => guarded(stopScheduler));
for (const input of schedulerInputs) {
  input.addEventListener('input', markSchedulerInputDirty);
}

guarded(async () => {
  await Promise.all([refreshState({ forceFormSync: true }), refreshLogs(), loadCloudCache()]);
});

setInterval(() => guarded(async () => {
  await Promise.all([refreshState(), refreshLogs()]);
}), 5000);
