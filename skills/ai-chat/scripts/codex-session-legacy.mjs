#!/usr/bin/env node
/**
 * codex-session.mjs — read-only helper for inspecting Codex session transcripts.
 *
 * STRICTLY READ-ONLY. This script never writes to the Codex home directory,
 * never sends messages, never makes network requests and never spawns a
 * subprocess. It only reads files under $CODEX_HOME.
 *
 * Sending is deliberately NOT implemented here — it must be an explicit,
 * user-authorized `codex queue` invocation (see SKILL.md).
 *
 * Usage:
 *   node codex-session.mjs list [--grep <pattern>] [--limit N]
 *   node codex-session.mjs path <thread-id-or-name>
 *   node codex-session.mjs read <thread-id-or-name> [--tail N] [--role user|assistant]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const INDEX = path.join(CODEX_HOME, 'session_index.jsonl');
const SESSIONS = path.join(CODEX_HOME, 'sessions');

/** Candidate locations of the app-bundled codex CLI (never executed here). */
const CLI_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  path.join(os.homedir(), '.codex', 'bin', 'codex'),
];

function die(msg) {
  process.stderr.write(`codex-session: ${msg}\n`);
  process.exit(1);
}

function readIndex() {
  if (!fs.existsSync(INDEX)) die(`session index not found: ${INDEX}`);
  const out = [];
  for (const line of fs.readFileSync(INDEX, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

function listSessions({ grep, limit }) {
  let rows = readIndex();
  if (grep) {
    const re = new RegExp(grep, 'i');
    rows = rows.filter((r) => re.test(r.thread_name || '') || re.test(r.id || ''));
  }
  rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (limit) rows = rows.slice(0, limit);
  for (const r of rows) {
    process.stdout.write(`${r.id}\t${r.updated_at || '-'}\t${r.thread_name || '(unnamed)'}\n`);
  }
  if (!rows.length) process.stdout.write('(no matching sessions)\n');
}

function resolveThread(needle) {
  const rows = readIndex();
  const exact = rows.find((r) => r.id === needle || r.thread_name === needle);
  if (exact) return exact;
  const loose = rows.filter(
    (r) => (r.thread_name || '').includes(needle) || (r.id || '').includes(needle),
  );
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    die(`ambiguous match for "${needle}" (${loose.length} sessions); use the exact id`);
  }
  if (fs.existsSync(SESSIONS)) {
    try {
      const all = fs.readdirSync(SESSIONS, { recursive: true, withFileTypes: true });
      const hits = all.filter((e) => e.isFile() && e.name.includes(needle) && e.name.endsWith('.jsonl'));
      if (hits.length === 1) {
        return { id: needle, thread_name: '(cli session)' };
      }
    } catch { /* ignore */ }
  }
  die(`no session matching "${needle}"`);
}

function findRollout(threadId) {
  if (!fs.existsSync(SESSIONS)) die(`sessions dir not found: ${SESSIONS}`);
  const all = fs.readdirSync(SESSIONS, { recursive: true, withFileTypes: true });
  const hits = all
    .filter((e) => e.isFile() && e.name.includes(threadId) && e.name.endsWith('.jsonl'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
  if (!hits.length) die(`no rollout file found for thread ${threadId}`);
  hits.sort();
  return hits[hits.length - 1];
}

function loadRecords(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

const textOf = (p) => {
  const c = p.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => x.text || '').join('');
  return '';
};

function readSession(needle, { tail, role }) {
  const rec = resolveThread(needle);
  const file = findRollout(rec.id);
  const records = loadRecords(file);

  const msgs = [];
  for (const r of records) {
    if (r.type !== 'response_item') continue;
    const p = r.payload || {};
    if (p.type !== 'message') continue;
    if (p.role !== 'user' && p.role !== 'assistant') continue;
    if (role && p.role !== role) continue;
    const t = textOf(p).trim();
    if (!t) continue;
    msgs.push({ ts: r.timestamp, role: p.role, text: t });
  }

  const shown = tail ? msgs.slice(-tail) : msgs;
  process.stdout.write(`# ${rec.thread_name || '(unnamed)'}  [${rec.id}]\n`);
  process.stdout.write(`# rollout: ${file}\n`);
  process.stdout.write(`# messages: ${msgs.length} shown: ${shown.length}\n\n`);
  for (const m of shown) {
    process.stdout.write(`--- ${m.role} [${m.ts}] (${m.text.length} chars) ---\n${m.text}\n\n`);
  }
}

function showPath(needle) {
  const rec = resolveThread(needle);
  const file = findRollout(rec.id);
  process.stdout.write(`thread_id: ${rec.id}\n`);
  process.stdout.write(`name: ${rec.thread_name || '(unnamed)'}\n`);
  process.stdout.write(`rollout: ${file}\n`);
  const cli = CLI_CANDIDATES.find((p) => fs.existsSync(p));
  process.stdout.write(`codex_cli: ${cli || '(not found — set CODEX_HOME or edit CLI_CANDIDATES)'}\n`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'list':
    listSessions({
      grep: flag(rest, '--grep'),
      limit: Number(flag(rest, '--limit')) || 0,
    });
    break;
  case 'path':
    if (!rest[0]) die('usage: path <thread-id-or-name>');
    showPath(rest[0]);
    break;
  case 'read':
    if (!rest[0]) die('usage: read <thread-id-or-name> [--tail N] [--role user|assistant]');
    readSession(rest[0], {
      tail: Number(flag(rest, '--tail')) || 0,
      role: flag(rest, '--role'),
    });
    break;
  default:
    process.stdout.write(
      'usage:\n' +
      '  codex-session.mjs list [--grep <pattern>] [--limit N]\n' +
      '  codex-session.mjs path <thread-id-or-name>\n' +
      '  codex-session.mjs read <thread-id-or-name> [--tail N] [--role user|assistant]\n',
    );
    process.exit(cmd ? 1 : 0);
}
