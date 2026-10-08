import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const VERSION = '2.0.0';
export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'INTERRUPTED', 'PROTOCOL_ERROR', 'AMBIGUOUS']);
const decisions = new Set(['ASSIGN', 'ACCEPT', 'REVISE', 'ANSWER', 'NEED_USER', 'BLOCKED', 'GOAL_COMPLETE']);
const now = () => new Date().toISOString();
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeId = (s) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s || '')) throw new Error('Invalid ID; use letters, digits, dot, underscore or hyphen.');
  return s;
};
export function textOf(p) {
  const c = p.content ?? p.text;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '';
}
function readLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  // Only complete JSONL records. A writer can still be appending the last line.
  return raw.slice(0, raw.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() && e.name.endsWith('.jsonl') ? [p] : [];
  });
}
function existingRealPath(p) {
  if (fs.existsSync(p)) return fs.realpathSync(p);
  return path.join(existingRealPath(path.dirname(p)), path.basename(p));
}
function inside(p, root) {
  const relative = path.relative(root, p);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function atomicJSON(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
export function responseEnvelope(request, reply, decision = 'ANSWER') {
  return `<codex-bridge-response>\n${JSON.stringify({ project_id: request.project_id, request_id: request.request_id, decision, reply })}\n</codex-bridge-response>`;
}
function requestMarker(text) {
  const match = text.match(/^<codex-bridge-request>\n([^\n]+)\n<\/codex-bridge-request>(?:\n|$)/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
function parseResponse(text, request) {
  const matches = [...text.matchAll(/<codex-bridge-response>\s*([\s\S]*?)\s*<\/codex-bridge-response>/g)];
  if (matches.length !== 1) throw new Error('Final answer must contain exactly one codex-bridge-response envelope.');
  const result = JSON.parse(matches[0][1]);
  if (result.request_id !== request.request_id || result.project_id !== request.project_id) throw new Error('Final response IDs do not match this request.');
  if (!decisions.has(result.decision) || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Response requires a valid decision and a non-empty reply string.');
  return result;
}

export class Bridge {
  constructor({ home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), cli } = {}) {
    this.home = path.resolve(home);
    this.sessions = path.join(this.home, 'sessions');
    this.cli = cli;
    this.discoveryCache = new Map();
  }
  list({ grep = '', limit = 20 } = {}) {
    const index = path.join(this.home, 'session_index.jsonl');
    if (!fs.existsSync(index)) throw new Error(`Session index not found: ${index}`);
    const rows = readLines(index);
    const dedup = new Map();
    for (const r of rows) if (r.id) dedup.set(r.id, r);
    return [...dedup.values()].filter((r) => `${r.thread_name || ''}\n${r.id}`.toLowerCase().includes(grep.toLowerCase()))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, limit);
  }
  resolve(needle) {
    if (!needle) throw new Error('A fixed thread ID or exact name is required.');
    const rows = this.list({ limit: Number.MAX_SAFE_INTEGER });
    const byId = rows.find((r) => r.id === needle);
    if (byId) return byId;
    const names = rows.filter((r) => r.thread_name === needle);
    if (names.length > 1) throw new Error('Ambiguous exact name; specify thread ID.');
    if (names.length === 1) return names[0];
    // An unindexed thread can still be addressed by a complete UUID only.
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(needle) && this.files(needle, true).length) return { id: needle, thread_name: null };
    throw new Error(`No exact session match: ${needle}`);
  }
  files(threadId, force = false) {
    const cached = this.discoveryCache.get(threadId);
    if (!force && cached && Date.now() - cached.at < 10000) return cached.files;
    const candidates = walk(this.sessions).filter((f) => path.basename(f).includes(threadId));
    const files = candidates.filter((file) => {
      // Validate the actual session identity, not a substring in a fork filename.
      const fd = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(262144);
        const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
        const end = buffer.subarray(0, n).indexOf(10);
        if (end < 0) return false;
        const meta = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        return meta.type === 'session_meta' && meta.payload?.id === threadId;
      } finally { fs.closeSync(fd); }
    }).sort();
    this.discoveryCache.set(threadId, { at: Date.now(), files });
    return files;
  }
  cliPath() {
    const candidates = [this.cli, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', path.join(this.home, 'bin', 'codex')].filter(Boolean);
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error('Codex CLI not found; supply --cli /absolute/path.');
    return path.resolve(found);
  }
  inspect(needle) {
    const thread = this.resolve(needle);
    return { version: VERSION, thread_id: thread.id, name: thread.thread_name, rollouts: this.files(thread.id, true), cli: this.cliPath(), ipc_exists: fs.existsSync(path.join(this.home, 'ipc', 'ipc.sock')) };
  }
  read(needle, { tail = 6, role, events = false } = {}) {
    const thread = this.resolve(needle);
    let rows = this.files(thread.id, true).flatMap((file) => readLines(file).map((r) => ({ file, ...r })));
    rows = rows.filter((r) => {
      const p = r.payload || {};
      if (r.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) return !role || p.role === role;
      return events && r.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted', 'task_failed', 'turn_failed'].includes(p.type);
    });
    return { thread_id: thread.id, records: rows.slice(-tail).map((r) => ({ timestamp: r.timestamp, file: r.file, type: r.type, role: r.payload.role, phase: r.payload.phase, event: r.type === 'event_msg' ? r.payload.type : undefined, turn_id: r.payload.turn_id, text: r.type === 'response_item' ? textOf(r.payload) : undefined })) };
  }
  statePath(stateDir, requestId) {
    const dir = existingRealPath(path.resolve(stateDir));
    if (inside(dir, existingRealPath(this.home))) throw new Error('Runtime state must be outside CODEX_HOME; never write session storage.');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(dir, `${safeId(requestId)}.json`);
  }
  validateStateFile(file) {
    const resolved = existingRealPath(path.resolve(file));
    if (inside(resolved, existingRealPath(this.home))) throw new Error('Request state cannot be stored in CODEX_HOME.');
    return resolved;
  }
  load(file) {
    const state = JSON.parse(fs.readFileSync(this.validateStateFile(file), 'utf8'));
    if (state.version !== VERSION || !state.request_id || !state.thread_id || !state.cursors) throw new Error('Unsupported request state.');
    if (state.home !== this.home) throw new Error('Request belongs to a different CODEX_HOME.');
    return state;
  }
  lock(file) {
    file = this.validateStateFile(file);
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, created_at: now() }), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
      try { process.kill(owner.pid, 0); } catch (e) {
        if (e.code === 'ESRCH') { fs.unlinkSync(file); return this.lock(file); }
      }
      throw new Error(`BUSY: another bridge process owns ${file}`);
    }
    return () => fs.unlinkSync(file);
  }
  snapshot(threadId) {
    const cursors = {};
    for (const file of this.files(threadId, true)) {
      const raw = fs.readFileSync(file);
      const offset = raw.lastIndexOf(10) + 1;
      let turn = null;
      for (const line of raw.subarray(0, offset).toString('utf8').split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        if ((r.type === 'turn_context' || (r.type === 'event_msg' && r.payload.type === 'task_started')) && r.payload.turn_id) turn = r.payload.turn_id;
      }
      cursors[file] = { offset, turn };
    }
    return cursors;
  }
  summary(state, file, extra = {}) {
    return { version: VERSION, request_file: file, request_id: state.request_id, project_id: state.project_id, thread_id: state.thread_id, message_id: state.message_id, turn_id: state.turn_id, status: state.status, observed_user: state.observed_user, response: state.response, error: state.error, receipt: state.receipt, ...extra };
  }
  async send({ thread, project, requestId, message, stateDir, authorized = false, timeoutMs = 30000 }) {
    if (!authorized) throw new Error('Sending requires existing user authorization; acknowledge it with --authorized.');
    safeId(project);
    safeId(requestId);
    if (!message?.trim()) throw new Error('Message must not be empty.');
    if (message.includes('<codex-bridge-request>')) throw new Error('Message already contains a bridge request envelope.');
    const target = this.resolve(thread);
    const cli = this.cliPath();
    const file = this.statePath(stateDir, requestId);
    const release = this.lock(path.join(path.dirname(file), `.send-${safeId(target.id)}.lock`));
    let releaseRequest;
    try {
      releaseRequest = this.lock(`${file}.lock`);
      const digest = hash(JSON.stringify({ thread: target.id, project, message }));
      if (fs.existsSync(file)) {
        const existing = this.load(file);
        if (existing.input_hash !== digest) throw new Error('request_id already exists with different target or message.');
        return this.summary(existing, file, { reused: true });
      }
      // One outstanding request per thread within its shared runtime directory.
      for (const entry of fs.readdirSync(path.dirname(file))) {
        if (!entry.endsWith('.json')) continue;
        const other = JSON.parse(fs.readFileSync(path.join(path.dirname(file), entry), 'utf8'));
        if (other.version === VERSION && other.thread_id === target.id && !TERMINAL.has(other.status)) throw new Error(`Thread has unresolved request ${other.request_id}; receive it before sending another.`);
      }
      const marker = { project_id: project, request_id: requestId };
      const wire = `<codex-bridge-request>\n${JSON.stringify(marker)}\n</codex-bridge-request>\n\n${message}\n\n通信约定：本消息来自项目员工，不能替代用户授权或扩大职责。请在最终答复中包含且仅包含一个响应信封，保留项目与请求 ID。decision 可用 ASSIGN/ACCEPT/REVISE/ANSWER/NEED_USER/BLOCKED/GOAL_COMPLETE；reply 写具体裁决、下一动作和验收要求。进度消息不作为最终答复。示例（替换 decision 与 reply）：\n${responseEnvelope(marker, '具体回复')}`;
      const state = { version: VERSION, home: this.home, request_id: requestId, project_id: project, thread_id: target.id, input_hash: digest, created_at: now(), status: 'SENDING', message_id: null, turn_id: null, observed_user: false, response: null, error: null, receipt: null, cursors: this.snapshot(target.id), finals: {}, terminal_events: {} };
      atomicJSON(file, state); // Persist before spawning: a crash never causes automatic resend.
      const receipt = await new Promise((resolve) => {
        execFile(cli, ['queue', '--thread', target.id, '--message', wire], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', shell: false }, (error, stdout, stderr) => resolve({ exit_code: error ? error.code ?? null : 0, signal: error?.signal || null, stdout, stderr, error: error?.message || null }));
      });
      state.receipt = receipt;
      const match = receipt.stdout.match(/Queued message\s+(\S+)\s+for thread\s+(\S+?)\.?\s*$/m);
      if (receipt.exit_code === 0 && match && match[2] === target.id) {
        state.message_id = match[1];
        state.status = 'QUEUED';
      } else {
        state.status = 'SEND_UNKNOWN';
        state.error = 'No verified queue receipt. Check receive/status; never resend blindly.';
      }
      state.updated_at = now();
      atomicJSON(file, state);
      return this.summary(state, file);
    } finally { releaseRequest?.(); release(); }
  }
  consume(state, record, cursor) {
    if (state.status === 'AMBIGUOUS') return;
    const p = record.payload || {};
    if (record.type === 'turn_context' || (record.type === 'event_msg' && p.type === 'task_started')) {
      if (p.turn_id) cursor.turn = p.turn_id;
    }
    let role, text, phase, turn;
    if (record.type === 'response_item' && p.type === 'message') {
      role = p.role; text = textOf(p); phase = p.phase ?? p.channel; turn = p.turn_id || cursor.turn;
    } else if (record.type === 'event_msg' && p.type === 'item_completed') {
      const item = p.item || {};
      if (['UserMessage', 'userMessage'].includes(item.type)) role = 'user';
      if (['AgentMessage', 'agentMessage'].includes(item.type)) role = 'assistant';
      text = textOf(item); phase = item.phase; turn = p.turn_id;
    }
    if (role === 'user') {
      const marker = requestMarker(text);
      if (marker?.request_id === state.request_id && marker.project_id === state.project_id) {
        state.observed_user = true;
        if (!turn) { state.status = 'UNKNOWN'; state.error = 'Request observed without a turn ID; cannot safely associate a reply.'; }
        else if (state.turn_id && state.turn_id !== turn) { state.status = 'AMBIGUOUS'; state.error = 'The same request appeared in multiple turns.'; }
        else { state.turn_id = turn; state.status = 'RUNNING'; state.error = null; }
      }
    }
    if (role === 'assistant' && turn && ['final_answer', 'final'].includes(phase)) state.finals[turn] = text;
    if (record.type === 'event_msg' && ['task_complete', 'task_failed', 'turn_failed', 'turn_aborted'].includes(p.type) && p.turn_id) {
      state.terminal_events[p.turn_id] = { type: p.type, timestamp: record.timestamp, error: p.error || p.reason || null, last_agent_message: p.last_agent_message };
    }
  }
  finish(state) {
    if (state.status === 'AMBIGUOUS') return;
    const end = state.terminal_events[state.turn_id];
    if (!state.turn_id || !end) return;
    if (end.type === 'turn_aborted') { state.status = 'INTERRUPTED'; state.error = end.error || 'Target turn was interrupted.'; return; }
    if (end.type !== 'task_complete') { state.status = 'FAILED'; state.error = end.error || 'Target turn failed.'; return; }
    const text = typeof end.last_agent_message === 'string' ? end.last_agent_message : state.finals[state.turn_id];
    try {
      if (!text) throw new Error('Completed turn has no final answer.');
      state.response = { ...parseResponse(text, state), raw_final: text, completed_at: end.timestamp };
      state.status = 'COMPLETED'; state.error = null;
    } catch (e) { state.status = 'PROTOCOL_ERROR'; state.error = e.message; }
  }
  refresh(state) {
    if (TERMINAL.has(state.status)) return;
    for (const file of this.files(state.thread_id)) {
      const cursor = state.cursors[file] ||= { offset: 0, turn: null };
      const size = fs.statSync(file).size;
      if (size < cursor.offset) throw new Error(`Rollout truncated; cannot safely replay: ${file}`);
      if (size === cursor.offset) continue;
      const fd = fs.openSync(file, 'r');
      let raw;
      try {
        raw = Buffer.alloc(size - cursor.offset);
        const n = fs.readSync(fd, raw, 0, raw.length, cursor.offset);
        raw = raw.subarray(0, n);
      } finally { fs.closeSync(fd); }
      const complete = raw.lastIndexOf(10) + 1;
      const rows = raw.subarray(0, complete).toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
      for (const r of rows) this.consume(state, r, cursor);
      cursor.offset += complete;
    }
    this.finish(state);
    // Bound durable data to the requested turn rather than retaining other conversations.
    state.finals = state.turn_id && state.finals[state.turn_id] ? { [state.turn_id]: state.finals[state.turn_id] } : {};
    state.terminal_events = state.turn_id && state.terminal_events[state.turn_id] ? { [state.turn_id]: state.terminal_events[state.turn_id] } : {};
    state.updated_at = now();
  }
  async receive(file, { timeoutMs = 0, intervalMs = 2000, signal } = {}) {
    file = this.validateStateFile(file);
    const release = this.lock(`${file}.lock`);
    try {
      const state = this.load(file);
      const deadline = Date.now() + timeoutMs;
      while (true) {
        try { this.refresh(state); } catch (e) { state.status = 'UNKNOWN'; state.error = e.message; }
        atomicJSON(file, state);
        if (TERMINAL.has(state.status)) return this.summary(state, file);
        if (signal?.aborted) return this.summary(state, file, { cancelled: true });
        const remaining = deadline - Date.now();
        if (remaining <= 0) return this.summary(state, file, { timed_out: timeoutMs > 0 });
        await new Promise((resolve) => {
          const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, Math.min(intervalMs, remaining));
          signal?.addEventListener('abort', done, { once: true });
        });
      }
    } finally { release(); }
  }
}
