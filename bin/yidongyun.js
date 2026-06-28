#!/usr/bin/env node
'use strict';

const {
  usageText,
  loadState,
  maskState,
  smsSend,
  smsLogin,
  listClouds,
  getAuth,
  keepalive,
  parseArgs,
} = requireCore();

function requireCore() {
  try {
    return require('../lib/core');
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    return require('/usr/local/lib/yidongyun/core');
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (cmd === 'sms-send') return smsSend(args._[1]);
  if (cmd === 'sms-login') {
    const result = await smsLogin(args._[1], args._[2]);
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (cmd === 'list') return listClouds();
  if (cmd === 'auth') return console.log(JSON.stringify(await getAuth(args._[1]), null, 2));
  if (cmd === 'keepalive') return keepalive(args);
  if (cmd === 'state') return console.log(JSON.stringify(maskState(loadState()), null, 2));

  console.log(usageText());
  return undefined;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
