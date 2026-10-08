import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge, responseEnvelope } from './bridge-core.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const event = (type, extra = {}) => ({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type, ...extra } });
const message = (role, text, phase) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: 'input_text', text }], phase } });
const marker = (request, project = 'p1') => `<codex-bridge-request>\n${JSON.stringify({ project_id: project, request_id: request })}\n</codex-bridge-request>\n\nhello`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const dir = path.join(home, 'sessions', '2026', '10', '08');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'session_index.jsonl'), [id, second].map((id) => JSON.stringify({ id, thread_name: 'architect' })).join('\n') + '\n');
  const capture = path.join(root, 'capture.json');
  const cli = path.join(root, 'fake codex.mjs');
  fs.writeFileSync(cli, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\nconsole.log('Queued message msg-123 for thread ' + process.argv[4] + '.');\n`, { mode: 0o700 });
  const bridge = new Bridge({ home, cli });
  const create = (thread = id, suffix = '') => {
    const file = path.join(dir, `rollout-2026-10-08T00-00-00-${thread}${suffix}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: thread } }) + '\n');
    return file;
  };
  const file = create();
  const append = (file, ...records) => fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const send = (requestId = 'r1', options = {}) => bridge.send({ thread: id, project: 'p1', requestId, message: 'hello', stateDir, authorized: true, ...options });
  const start = (request = 'r1', turn = 't1', project = 'p1', target = file) => append(target, event('task_started', { turn_id: turn }), message('user', marker(request, project)));
  const complete = (request = 'r1', turn = 't1', project = 'p1', target = file) => {
    const text = responseEnvelope({ request_id: request, project_id: project }, 'Read PROJECT.md and report existence.', 'ASSIGN');
    append(target, message('assistant', text, 'final_answer'), event('task_complete', { turn_id: turn, last_agent_message: text }));
  };
  return { root, home, stateDir, bridge, cli, capture, file, create, append, send, start, complete };
}

test('send preserves exact shell-sensitive content and repeated send never spawns twice', async (t) => {
  const f = fixture(t);
  const body = '你好\n`touch /tmp/SHOULD_NOT_RUN` $(echo SECRET) $HOME "quotes"';
  const out = await f.send('r1', { message: body });
  assert.equal(out.status, 'QUEUED');
  const args = JSON.parse(fs.readFileSync(f.capture));
  assert.deepEqual(args.slice(0, 4), ['queue', '--thread', id, '--message']);
  assert.ok(args[4].includes(body));
  const before = fs.statSync(f.capture).mtimeMs;
  const duplicate = await f.send('r1', { message: body });
  assert.equal(duplicate.reused, true);
  assert.equal(fs.statSync(f.capture).mtimeMs, before);
  await assert.rejects(f.send('r1', { message: 'changed' }), /different target or message/);
});
test('old replies, commentary, and another turn completion cannot finish the request', async (t) => {
  const f = fixture(t);
  f.start('old', 'old-turn'); f.complete('old', 'old-turn');
  const out = await f.send();
  f.start();
  f.append(f.file, message('assistant', responseEnvelope({ request_id: 'r1', project_id: 'p1' }, 'progress'), 'commentary'), event('task_complete', { turn_id: 'other' }));
  const running = await f.bridge.receive(out.request_file);
  assert.equal(running.status, 'RUNNING');
  assert.equal(running.response, null);
  f.complete();
  const done = await new Bridge({ home: f.home, cli: f.cli }).receive(out.request_file);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.turn_id, 't1');
  assert.equal(done.response.decision, 'ASSIGN');
});
test('partial UTF-8 JSONL write is completed on next read without losing bytes', async (t) => {
  const f = fixture(t); const out = await f.send(); f.start();
  const text = responseEnvelope({ request_id: 'r1', project_id: 'p1' }, '中文完成');
  const raw = Buffer.from(JSON.stringify(event('task_complete', { turn_id: 't1', last_agent_message: text })) + '\n');
  const cut = raw.indexOf(Buffer.from('中文')) + 1;
  fs.appendFileSync(f.file, raw.subarray(0, cut));
  assert.equal((await f.bridge.receive(out.request_file)).status, 'RUNNING');
  fs.appendFileSync(f.file, raw.subarray(cut));
  assert.equal((await f.bridge.receive(out.request_file)).response.reply, '中文完成');
});
test('new rollout segments are discovered; similarly named fork identity is excluded', async (t) => {
  const f = fixture(t); const out = await f.send();
  const wrong = f.create(id, '_fork');
  fs.writeFileSync(wrong, JSON.stringify({ type: 'session_meta', payload: { id: second } }) + '\n');
  f.start('r1', 'wrong', 'p1', wrong); f.complete('r1', 'wrong', 'p1', wrong);
  const next = f.create(id, '_segment');
  f.start('r1', 'right', 'p1', next); f.complete('r1', 'right', 'p1', next);
  const done = await new Bridge({ home: f.home, cli: f.cli }).receive(out.request_file);
  assert.equal(done.turn_id, 'right'); assert.equal(done.status, 'COMPLETED');
});
test('uppercase UserMessage/AgentMessage item events associate explicit turn IDs', async (t) => {
  const f = fixture(t); const out = await f.send();
  const text = responseEnvelope({ request_id: 'r1', project_id: 'p1' }, 'answer');
  f.append(f.file, event('item_completed', { turn_id: 'explicit', item: { type: 'UserMessage', content: [{ type: 'Text', text: marker('r1') }] } }), event('item_completed', { turn_id: 'explicit', item: { type: 'AgentMessage', phase: 'final_answer', content: [{ type: 'Text', text }] } }), event('task_complete', { turn_id: 'explicit' }));
  assert.equal((await f.bridge.receive(out.request_file)).status, 'COMPLETED');
});
for (const [kind, status] of [['turn_aborted', 'INTERRUPTED'], ['task_failed', 'FAILED'], ['turn_failed', 'FAILED']]) {
  test(`${kind} is terminal without pretending acceptance`, async (t) => {
    const f = fixture(t); const out = await f.send(); f.start();
    f.append(f.file, event(kind, { turn_id: 't1', reason: 'stopped' }));
    assert.equal((await f.bridge.receive(out.request_file)).status, status);
  });
}
test('missing or mismatched final envelope is a protocol error', async (t) => {
  const f = fixture(t); const out = await f.send(); f.start(); f.complete('another');
  assert.equal((await f.bridge.receive(out.request_file)).status, 'PROTOCOL_ERROR');
});
test('one request observed in two turns is ambiguous', async (t) => {
  const f = fixture(t); const out = await f.send(); f.start(); f.start('r1', 't2'); f.start('r1', 't1'); f.complete();
  assert.equal((await f.bridge.receive(out.request_file)).status, 'AMBIGUOUS');
});
test('two projects receive separate results; unresolved same-thread request is rejected', async (t) => {
  const f = fixture(t); const a = await f.send();
  await assert.rejects(f.send('r2'), /unresolved request/);
  const bfile = f.create(second);
  const b = await f.send('r2', { thread: second, project: 'p2' });
  f.start('r2', 'tb', 'p2', bfile); f.complete('r2', 'tb', 'p2', bfile);
  f.start(); f.complete();
  assert.equal((await f.bridge.receive(a.request_file)).response.project_id, 'p1');
  assert.equal((await f.bridge.receive(b.request_file)).response.project_id, 'p2');
  assert.equal((await f.send('r3')).status, 'QUEUED');
});
test('timeout persists cursor; restart receives without resend; cancellation preserves target', async (t) => {
  const f = fixture(t); const out = await f.send(); f.start();
  const waiting = await f.bridge.receive(out.request_file, { timeoutMs: 20, intervalMs: 5 });
  assert.equal(waiting.timed_out, true); assert.equal(waiting.status, 'RUNNING');
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.bridge.receive(out.request_file, { timeoutMs: 100, signal: controller.signal })).cancelled, true);
  f.complete();
  assert.equal((await new Bridge({ home: f.home, cli: f.cli }).receive(out.request_file)).status, 'COMPLETED');
});
test('queue failure is unknown and duplicate send cannot retry it', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.cli, `#!${process.execPath}\nprocess.stderr.write('connection failed'); process.exit(1);\n`, { mode: 0o700 });
  const out = await f.send(); assert.equal(out.status, 'SEND_UNKNOWN');
  assert.equal((await f.send()).reused, true);
});
test('authorization, exact-name ambiguity, and protected/symlinked runtime paths are enforced', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.send('r1', { authorized: false }), /authorization/);
  assert.throws(() => f.bridge.resolve('architect'), /Ambiguous/);
  await assert.rejects(f.send('r1', { stateDir: path.join(f.home, 'sessions', 'runtime') }), /outside CODEX_HOME/);
  const link = path.join(f.root, 'link'); fs.symlinkSync(f.home, link);
  await assert.rejects(f.send('r1', { stateDir: path.join(link, 'runtime') }), /outside CODEX_HOME/);
});
test('truncated rollout cannot be mistaken for a completed reply', async (t) => {
  const f = fixture(t); const out = await f.send(); f.start(); await f.bridge.receive(out.request_file);
  fs.writeFileSync(f.file, '');
  const status = await f.bridge.receive(out.request_file);
  assert.equal(status.status, 'UNKNOWN'); assert.match(status.error, /truncated/);
});
test('CLI smoke supports JSON read/status and contains no shell interpretation', async (t) => {
  const f = fixture(t);
  const cli = new URL('./codex-session.mjs', import.meta.url);
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(cli), 'path', id, '--codex-home', f.home, '--cli', f.cli], { encoding: 'utf8' }));
  assert.equal(result.thread_id, id);
});
test('overlapping send/receive is locked and a crashed sender can be inspected', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.cli, `#!${process.execPath}\nsetTimeout(() => console.log('Queued message m for thread ${id}.'), 100);\n`, { mode: 0o700 });
  const pending = f.send();
  const file = path.join(f.stateDir, 'r1.json');
  await assert.rejects(f.bridge.receive(file), /BUSY/);
  await pending;
  const state = JSON.parse(fs.readFileSync(file));
  state.status = 'SENDING'; state.message_id = null;
  fs.writeFileSync(file, JSON.stringify(state));
  assert.equal((await f.send()).reused, true);
  f.start(); f.complete();
  assert.equal((await f.bridge.receive(file)).status, 'COMPLETED');
});
