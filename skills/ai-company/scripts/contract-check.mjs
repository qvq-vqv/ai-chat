import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRecords, NOT_CHECKED} from './contract-check-core.mjs';
export const MAX_RECORD_BYTES = 1024 * 1024;
const failure = (code, field) => ({exitCode: 2, report: {status: 'INPUT_ERROR', ok: false,
  diagnostics: [{severity: 'ERROR', code, field, message: 'Cannot read a supported bounded JSON input.'}], not_checked: [...NOT_CHECKED]}});
function loadRecord(file) {
  let fd;
  try {
    // Nonblocking open rejects FIFOs without waiting; no referenced paths are followed.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Object.assign(Error(), {diagnostic: 'NOT_REGULAR_FILE'});
    if (stat.size > MAX_RECORD_BYTES) throw Object.assign(Error(), {diagnostic: 'INPUT_TOO_LARGE'});
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > MAX_RECORD_BYTES) throw Object.assign(Error(), {diagnostic: 'INPUT_TOO_LARGE'});
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, size))); }
    catch { throw Object.assign(Error(), {diagnostic: 'INVALID_JSON'}); }
  } catch (error) {
    throw Object.assign(Error(), {diagnostic: error.diagnostic || 'INPUT_UNREADABLE'});
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function run(argv) {
  if (argv.length === 1 && argv[0] === '--help') return {exitCode: 0, report: {usage: 'node contract-check.mjs --contract contract.json [--delivery delivery.json [--verdict verdict.json]]', max_record_bytes: MAX_RECORD_BYTES, read_only: true}};
  const files = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!['--contract', '--delivery', '--verdict'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--') || files[flag.slice(2)]) return failure('INVALID_ARGUMENTS', 'arguments');
    files[flag.slice(2)] = argv[i + 1];
  }
  if (!files.contract || (files.verdict && !files.delivery)) return failure('INVALID_ARGUMENTS', 'arguments');
  const records = {};
  for (const kind of ['contract', 'delivery', 'verdict']) if (files[kind]) {
    try { records[kind] = loadRecord(files[kind]); }
    catch (error) { return failure(error.diagnostic, kind); }
  }
  const report = checkRecords(records);
  return {exitCode: report.ok ? 0 : 1, report};
}
function isDirectEntry() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url); }
  catch { return false; }
}
if (isDirectEntry()) {
  const result = run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
