#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  createDefaultScheduler,
  formatElapsed,
  createSuccessSummary,
  applyRunSuccess,
  applyRunFailure,
  mergeSchedulerPatch,
  resolveStartupDelay,
  resolveFollowupDelay,
  formatClockTime,
  formatLogTime,
} = require('../server/web-server');

assert.strictEqual(formatElapsed(0), '0秒');
assert.strictEqual(formatElapsed(5_000), '5秒');
assert.strictEqual(formatElapsed(65_000), '1分5秒');
assert.strictEqual(formatElapsed((30 * 60 * 60 + 41 * 60 + 51) * 1000), '30小时41分51秒');
assert.strictEqual(formatClockTime('2026-06-28T06:21:43.826Z'), '14:21:43');
assert.match(formatLogTime('2026-06-28T06:21:43.826Z'), /^2026\/06\/28 14:21:43$/);

const scheduler = createDefaultScheduler();
assert.strictEqual(scheduler.enabled, false);
assert.strictEqual(scheduler.intervalMinutes, 10);
assert.strictEqual(scheduler.duration, 120);
assert.strictEqual(scheduler.successCount, 0);
assert.strictEqual(scheduler.consecutiveFailures, 0);
assert.strictEqual(scheduler.lastFailureReason, '');

const patched = mergeSchedulerPatch(scheduler, {
  enabled: true,
  userServiceId: '2663816',
  duration: 120,
  intervalMinutes: 10,
});
assert.strictEqual(patched.enabled, true);
assert.strictEqual(patched.userServiceId, '2663816');
assert.ok(patched.startedAt);

const summary = createSuccessSummary({
  successCount: 6,
  consecutiveSuccessSince: '2026-06-27T21:03:21.000Z',
  lastSuccessAt: '2026-06-29T03:45:12.000Z',
});
assert.match(summary, /^\[11:45:12\] \[6\] 保活成功: 30小时41分51秒$/);

const successfulScheduler = applyRunSuccess(
  {
    ...createDefaultScheduler(),
    enabled: true,
    startedAt: '2026-06-28T05:46:14.002Z',
    successCount: 20,
  },
  '2026-06-28T07:48:07.294Z',
  '2026-06-28T07:49:11.057Z'
);
assert.strictEqual(successfulScheduler.successCount, 21);
assert.strictEqual(successfulScheduler.consecutiveFailures, 0);
assert.strictEqual(successfulScheduler.lastVerdict, 'success');
assert.match(successfulScheduler.lastSummary, /^\[15:49:11\] \[21\] 保活成功:/);

const failedScheduler = applyRunFailure(
  { ...createDefaultScheduler(), enabled: true },
  new Error('SDK connect failed: 密码错误，您还有8次输入机会，账号将锁定')
);
assert.strictEqual(failedScheduler.enabled, false);
assert.strictEqual(failedScheduler.lastVerdict, 'failed');
assert.strictEqual(failedScheduler.consecutiveFailures, 1);
assert.match(failedScheduler.lastFailureReason, /SDK connect failed/);
assert.match(failedScheduler.lastSummary, /已自动停止/);

const transientFailedScheduler = applyRunFailure(
  { ...createDefaultScheduler(), enabled: true, consecutiveFailures: 2 },
  new TypeError('fetch failed')
);
assert.strictEqual(transientFailedScheduler.enabled, true);
assert.strictEqual(transientFailedScheduler.lastVerdict, 'retrying');
assert.strictEqual(transientFailedScheduler.consecutiveFailures, 3);
assert.match(transientFailedScheduler.lastFailureReason, /fetch failed/);
assert.match(transientFailedScheduler.lastSummary, /继续重试/);

const now = Date.parse('2026-06-28T07:50:00.000Z');
assert.strictEqual(resolveStartupDelay({ enabled: false }, now), null);
assert.strictEqual(resolveStartupDelay({ enabled: true }, now), 0);
assert.strictEqual(resolveStartupDelay({ enabled: true, nextRunAt: '2026-06-28T07:49:00.000Z' }, now), 0);
assert.strictEqual(resolveStartupDelay({ enabled: true, nextRunAt: '2026-06-28T07:55:00.000Z' }, now), 300000);
assert.deepStrictEqual(
  resolveFollowupDelay(
    { enabled: true, intervalMinutes: 5 },
    '2026-06-28T07:58:50.000Z',
    Date.parse('2026-06-28T07:59:54.000Z')
  ),
  { delayMs: 236000, nextRunAt: '2026-06-28T08:03:50.000Z' }
);
assert.deepStrictEqual(
  resolveFollowupDelay(
    { enabled: true, intervalMinutes: 5 },
    '2026-06-28T07:58:50.000Z',
    Date.parse('2026-06-28T08:04:00.000Z')
  ),
  { delayMs: 0, nextRunAt: '2026-06-28T08:03:50.000Z' }
);
