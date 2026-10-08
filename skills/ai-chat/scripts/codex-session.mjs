#!/usr/bin/env node
import fs from 'node:fs';
import { Bridge } from './bridge-core.mjs';

const usage = `Codex Session Bridge v2
  list [--grep text] [--limit 20]
  path <exact-thread-id-or-name>
  read <exact-thread-id-or-name> [--tail 6] [--role user|assistant] [--events]
  send --thread ID --project ID --request-id ID --message-file PATH --state-dir PATH --authorized
  status --request PATH
  wait --request PATH [--timeout-seconds 45] [--interval-seconds 2]
Global: --codex-home PATH --cli PATH
All output is JSON. Send is idempotent by request ID and never retries queue automatically.
Wait timeout means still waiting; rerun wait with the same request file, not send.
`;
const [command, ...argv] = process.argv.slice(2);
const options = {};
const positional = [];
const booleans = new Set(['authorized', 'events', 'help']);
try {
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
  const key = argv[i].slice(2);
  if (booleans.has(key)) options[key] = true;
  else {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = argv[++i];
  }
}
const required = (name) => { if (!options[name]) throw new Error(`--${name} is required`); return options[name]; };
const number = (name, fallback, min, max) => {
  const n = options[name] === undefined ? fallback : Number(options[name]);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be between ${min} and ${max}`);
  return n;
};
  if (!command || command === 'help' || command === '--help' || options.help) {
    process.stdout.write(usage);
  } else {
    const bridge = new Bridge({ home: options['codex-home'], cli: options.cli });
    let result;
    switch (command) {
      case 'list': result = bridge.list({ grep: options.grep, limit: number('limit', 20, 1, 1000000) }); break;
      case 'path': result = bridge.inspect(positional[0]); break;
      case 'read': result = bridge.read(positional[0], { tail: number('tail', 6, 1, 10000), role: options.role, events: options.events }); break;
      case 'send': result = await bridge.send({ thread: required('thread'), project: required('project'), requestId: required('request-id'), message: fs.readFileSync(required('message-file'), 'utf8'), stateDir: required('state-dir'), authorized: !!options.authorized }); break;
      case 'status': result = await bridge.receive(required('request')); break;
      case 'wait': {
        const controller = new AbortController();
        process.once('SIGINT', () => controller.abort());
        process.once('SIGTERM', () => controller.abort());
        result = await bridge.receive(required('request'), { timeoutMs: number('timeout-seconds', 45, 0, 3600) * 1000, intervalMs: number('interval-seconds', 2, 0.1, 60) * 1000, signal: controller.signal });
        break;
      }
      default: throw new Error(`Unknown command ${command}`);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'ERROR', error: error.message }) + '\n');
  process.exitCode = 1;
}
