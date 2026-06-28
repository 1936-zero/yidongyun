#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { analyzeSuccessSignals } = require('../server/web-server');

const successLog = `
===== 2026-06-28 11:10:01 keepalive start =====
auth ok: vmId=abc spuCode=zte-cloud-pc
connected command sent; holding 120s
[bootCypc] connectDesktop ret val:  0
disconnect callback  iCode: -3
disconnectDesktop ret val:  0
===== 2026-06-28 11:12:05 keepalive end =====
`;

const failedLog = `
===== 2026-06-28 11:00:01 keepalive start =====
auth ok: vmId=abc spuCode=zte-cloud-pc
connected command sent; holding 120s
[bootCypc] ./uSmartView_VDI_Client: error while loading shared libraries: libva.so.2: cannot open shared object file
===== 2026-06-28 11:02:05 keepalive end =====
`;

const runningLog = `
===== 2026-06-28 11:20:01 keepalive start =====
auth ok: vmId=abc spuCode=zte-cloud-pc
connected command sent; holding 120s
`;

const passwordLog = `
===== 2026-06-28 12:41:34 keepalive start =====
auth ok: vmId=abc spuCode=zte-cloud-pc
connected command sent; holding 120s
[bootCypc] sh: 1: lsb_release: not found
[bootCypc] connect callback function iCode: -1
 cMesg: 密码错误，您还有8次输入机会，账号将锁定
Response sent: {"command":"connect","iCode":-1,"msg":"密码错误，您还有8次输入机会，账号将锁定","vmID":"abc"}
`;

const fetchFailedLog = `
===== 2026-06-28 22:37:33 keepalive start =====
keepalive error: TypeError: fetch failed
    at async api (/app/lib/core.js:163:15)
`;

assert.deepStrictEqual(analyzeSuccessSignals(successLog).verdict, 'success');
assert.strictEqual(analyzeSuccessSignals(successLog).missing.length, 0);
assert.strictEqual(analyzeSuccessSignals(failedLog).verdict, 'failed');
assert.match(analyzeSuccessSignals(failedLog).reason, /shared libraries/);
assert.strictEqual(analyzeSuccessSignals(runningLog).verdict, 'running');
assert.ok(analyzeSuccessSignals('').missing.includes('keepalive start'));
assert.strictEqual(analyzeSuccessSignals(passwordLog).verdict, 'failed');
assert.match(analyzeSuccessSignals(passwordLog).reason, /密码错误/);
assert.strictEqual(analyzeSuccessSignals(fetchFailedLog).verdict, 'failed');
assert.match(analyzeSuccessSignals(fetchFailedLog).reason, /fetch failed/);
