import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityProvider } from './antigravity-session.mjs';

// The direct Antigravity provider talks to an app-provided agentapi CLI and reads a
// cooperative reply file. These tests inject both the CLI executor and the native
// auth check so no real app, credentials, or network are touched.
function setup(t, { contextAvailable = () => true, execute } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-session-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A real existing file so fs.existsSync(cli) passes; the actual CLI is mocked.
  const cli = path.join(root, 'fake-agentapi');
  fs.writeFileSync(cli, '#!/bin/sh\n');
  const calls = [];
  const runner = execute || (async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const command = args[0];
    if (command === 'get-conversation-metadata') return { stdout: 'metadata ok', stderr: '', code: 0 };
    if (command === 'send-message') return { stdout: 'queued', stderr: '', code: 0 };
    return { stdout: '{}', stderr: '', code: 0 };
  });
  const provider = new AntigravityProvider({ cli, execute: runner, contextAvailable });
  return { root, cli, calls, provider };
}

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('preflight rejects a non-UUID endpoint', async t => {
  const { provider } = setup(t);
  await assert.rejects(() => provider.preflight('not-a-uuid'), /exact conversation UUID/);
});

test('preflight rejects a missing agentapi CLI', async t => {
  const { root } = setup(t);
  const provider = new AntigravityProvider({ cli: path.join(root, 'nope'), execute: async () => ({}), contextAvailable: () => true });
  await assert.rejects(() => provider.preflight(UUID), /agentapi not found/);
});

test('preflight rejects missing native auth context', async t => {
  const { cli } = setup(t);
  const provider = new AntigravityProvider({ cli, execute: async () => ({}), contextAvailable: () => false });
  await assert.rejects(() => provider.preflight(UUID), /MISSING_NATIVE_CONTEXT/);
});

test('preflight validates metadata and returns PREFLIGHT_OK', async t => {
  const { provider, calls } = setup(t);
  const r = await provider.preflight(UUID);
  assert.equal(r.status, 'PREFLIGHT_OK');
  assert.equal(r.endpoint_id, UUID);
  assert.ok(calls.some(c => c.args[0] === 'get-conversation-metadata' && c.args[1] === UUID));
});

test('deliver invokes send-message with the endpoint and message', async t => {
  const { provider, calls } = setup(t);
  const r = await provider.deliver({ endpoint_id: UUID, reply_file: '/x' }, 'hello world');
  assert.ok(calls.some(c => c.args[0] === 'send-message' && c.args[1] === UUID && c.args[2] === 'hello world'));
  assert.match(r.note, /does not prove/);
});

test('deliver surfaces a native CLI failure instead of pretending success', async t => {
  const { cli } = setup(t);
  const provider = new AntigravityProvider({ cli, execute: async () => { throw new Error('spawn ENOENT'); }, contextAvailable: () => true });
  await assert.rejects(() => provider.deliver({ endpoint_id: UUID }, 'x'), /Antigravity native CLI request failed/);
});

test('poll returns null when the reply file is absent', async t => {
  const { provider, root } = setup(t);
  const r = await provider.poll({ project_root: root, reply_file: path.join(root, 'missing.response.json') });
  assert.equal(r, null);
});

test('poll returns null on a partial/invalid JSON write (SyntaxError)', async t => {
  const { provider, root } = setup(t);
  const file = path.join(root, 'partial.response.json');
  fs.writeFileSync(file, '{incomplete');
  const r = await provider.poll({ project_root: root, reply_file: file });
  assert.equal(r, null);
});

test('poll returns the parsed final record when valid', async t => {
  const { provider, root } = setup(t);
  const file = path.join(root, 'ok.response.json');
  const payload = { schema_version: 1, final: true, project_id: 'p', request_id: 'r', endpoint_id: 'e', request_token: 't', decision: 'ANSWER', reply: 'done' };
  fs.writeFileSync(file, JSON.stringify(payload));
  const r = await provider.poll({ project_root: root, reply_file: file });
  assert.deepEqual(r, payload);
});

test('poll throws when the reply file escapes the project root', async t => {
  const { provider, root } = setup(t);
  const outside = path.join(os.tmpdir(), 'escape.response.json');
  fs.writeFileSync(outside, '{}');
  t.after(() => fs.rmSync(outside, { force: true }));
  await assert.rejects(() => provider.poll({ project_root: root, reply_file: outside }), /escapes the project/);
});
