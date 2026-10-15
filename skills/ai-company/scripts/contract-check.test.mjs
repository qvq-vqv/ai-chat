import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkRecords} from './contract-check-core.mjs';
import {run, MAX_RECORD_BYTES} from './contract-check.mjs';
const doc = fs.readFileSync(new URL('../references/work-records.md', import.meta.url), 'utf8');
const source = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].slice(0, 3).map(m => JSON.parse(m[1]));
const fixture = () => { const [contract, delivery, verdict] = structuredClone(source); return {contract, delivery, verdict}; };
const codes = report => report.diagnostics.map(d => d.code);
const roots = [];
const sandbox = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-contract-check-')); roots.push(dir); return dir; };
test.after(() => roots.forEach(dir => fs.rmSync(dir, {force: true, recursive: true})));
const write = (dir, name, record) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(record)); return file; };
test('documentation records correlate; checker does not mutate or generate decisions', () => {
  const data = fixture(), before = JSON.stringify(data), report = checkRecords(data);
  assert.equal(report.ok, true); assert.deepEqual(report.diagnostics, []);
  assert.equal(report.status, 'STATIC_CHECK_OK'); assert.equal(report.decision, undefined);
  assert.ok(report.not_checked.includes('authorization_truth')); assert.equal(JSON.stringify(data), before);
});
test('bad object, nested row, null list, empty value and unsafe revision produce diagnostics without crashing', () => {
  for (const edit of [x => x.contract = null, x => x.contract.rule_baseline = [], x => x.contract.inputs = [null], x => x.contract.acceptance = null, x => x.contract.owner_role = ' ', x => x.delivery.revision = 1.5, x => x.verdict.review_results = [false]]) {
    const x = fixture(); edit(x); assert.equal(checkRecords(x).ok, false);
  }
});
for (const [field, value] of [['project_id', 'other'], ['goal_revision', 2], ['task_id', 'other'], ['revision', 2], ['owner_role', 'other']]) {
  test(`delivery mismatch: ${field}`, () => {
    const x = fixture(); x.delivery[field] = value;
    assert.ok(codes(checkRecords(x)).includes('IDENTITY_MISMATCH'));
  });
}
test('rules, inputs, submission and artifact mismatch are independently diagnosed', () => {
  for (const [edit, code] of [[x => x.delivery.rule_baseline_id = 'other', 'RULE_BASELINE_MISMATCH'], [x => x.delivery.results[0].input_version = 'v2', 'INPUT_VERSION_MISMATCH'], [x => x.verdict.artifact_version = 'v2', 'IDENTITY_MISMATCH'], [x => x.verdict.submission_request_id = 'other', 'IDENTITY_MISMATCH']]) {
    const x = fixture(); edit(x); assert.ok(codes(checkRecords(x)).includes(code));
  }
});
test('wrong resource writer and duplicate contract/input/result IDs are rejected', () => {
  for (const [edit, code] of [[x => x.contract.resources[0].writer = 'other', 'RESOURCE_OWNER_MISMATCH'], [x => x.contract.acceptance.push({...x.contract.acceptance[0]}), 'DUPLICATE_ID'], [x => x.contract.inputs.push({...x.contract.inputs[0]}), 'DUPLICATE_ID'], [x => x.delivery.results.push({...x.delivery.results[0]}), 'DUPLICATE_ID']]) {
    const x = fixture(); edit(x); assert.ok(codes(checkRecords(x)).includes(code));
  }
});
test('unknown result and review without submission cannot be accepted', () => {
  const x = fixture(); x.delivery.results[0].acceptance_id = 'other';
  assert.ok(codes(checkRecords(x)).includes('UNKNOWN_ACCEPTANCE'));
  assert.ok(codes(checkRecords(x)).includes('REVIEW_WITHOUT_DELIVERY'));
});
test('PASS requires reference and NOT_APPLICABLE requires reason', () => {
  const x = fixture(); x.delivery.results[0].evidence = ' ';
  assert.ok(codes(checkRecords(x)).includes('MISSING_EVIDENCE'));
  x.delivery.results[0].result = 'NOT_APPLICABLE';
  assert.ok(codes(checkRecords(x)).includes('MISSING_NA_REASON'));
});
test('explicit partial ACCEPT preserves failed conditions without claiming full acceptance', () => {
  const x = fixture(); x.contract.acceptance.push({...x.contract.acceptance[0], id: 'A2'});
  x.delivery.results.push({...x.delivery.results[0], acceptance_id: 'A2', result: 'FAIL', evidence: ''});
  assert.equal(checkRecords(x).ok, true);
  x.verdict.accepted_ids.push('A2');
  assert.ok(codes(checkRecords(x)).includes('ACCEPTED_ITEM_NOT_PASS'));
});
test('incomplete delivery and natural-language scope remain warnings rather than invented approval', () => {
  const x = fixture(); x.contract.acceptance.push({...x.contract.acceptance[0], id: 'A2'});
  delete x.verdict.accepted_ids;
  const report = checkRecords(x); assert.equal(report.ok, true);
  assert.ok(codes(report).includes('INCOMPLETE_DELIVERY')); assert.ok(codes(report).includes('ACCEPT_SCOPE_NOT_STRUCTURED'));
});
test('same-role review and GOAL_COMPLETE cannot establish independent or whole-goal acceptance', () => {
  const x = fixture(); x.verdict.reviewer_role = x.delivery.owner_role; x.verdict.decision = 'GOAL_COMPLETE';
  const report = checkRecords(x); assert.ok(codes(report).includes('SELF_REVIEW')); assert.ok(codes(report).includes('GOAL_COMPLETE_NOT_PROVEN'));
  assert.ok(report.not_checked.includes('full_goal_acceptance_or_safe_closure'));
});
test('optional phases do not require fake delivery or verdict; verdict requires delivery', () => {
  const x = fixture(); const report = checkRecords({contract: x.contract});
  assert.equal(report.ok, true); assert.ok(codes(report).includes('DELIVERY_NOT_PROVIDED'));
  assert.equal(checkRecords({contract: x.contract, verdict: x.verdict}).ok, false);
});
test('CLI only reads explicit inputs, preserves bytes, never executes embedded commands or reads evidence URLs', () => {
  const dir = sandbox(), x = fixture(), marker = path.join(dir, 'never-created');
  x.contract.extra_command = `touch ${marker}`; x.contract.inputs[0].reference = 'https://example.invalid/private';
  const files = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, write(dir, `${k}.json`, v)]));
  const before = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, fs.readFileSync(p)]));
  const args = Object.entries(files).flatMap(([k, p]) => [`--${k}`, p]);
  const proc = spawnSync(process.execPath, [fileURLToPath(new URL('./contract-check.mjs', import.meta.url)), ...args], {encoding: 'utf8', timeout: 5000});
  assert.equal(proc.status, 0, proc.stderr); assert.equal(JSON.parse(proc.stdout).ok, true);
  assert.equal(fs.existsSync(marker), false);
  for (const [k, p] of Object.entries(files)) assert.deepEqual(fs.readFileSync(p), before[k]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['contract.json', 'delivery.json', 'verdict.json']);
});
test('input errors do not echo sensitive JSON values or contents', () => {
  const dir = sandbox(), file = path.join(dir, 'record.json'); fs.writeFileSync(file, '{secret: SENSITIVE_PAYLOAD');
  const result = run(['--contract', file]); assert.equal(result.exitCode, 2);
  assert.equal(result.report.diagnostics[0].code, 'INVALID_JSON'); assert.ok(!JSON.stringify(result).includes('SENSITIVE_PAYLOAD'));
  fs.writeFileSync(file, JSON.stringify({project_id: 'SENSITIVE_PAYLOAD'}));
  assert.ok(!JSON.stringify(run(['--contract', file])).includes('SENSITIVE_PAYLOAD'));
});
test('oversized, directory, missing and symlink inputs are bounded errors', () => {
  const dir = sandbox(), file = path.join(dir, 'large.json'); fs.writeFileSync(file, ' '.repeat(MAX_RECORD_BYTES + 1));
  assert.equal(run(['--contract', file]).report.diagnostics[0].code, 'INPUT_TOO_LARGE');
  assert.equal(run(['--contract', dir]).report.diagnostics[0].code, 'NOT_REGULAR_FILE');
  assert.equal(run(['--contract', path.join(dir, 'absent')]).exitCode, 2);
  const link = path.join(dir, 'link'); fs.symlinkSync(file, link); assert.equal(run(['--contract', link]).exitCode, 2);
});
test('CLI rejects unknown, duplicate and missing arguments and unpaired verdict', () => {
  for (const args of [[], ['--contract'], ['--contract', 'x', '--contract', 'y'], ['--contract', 'x', '--output', 'y'], ['--contract', 'x', '--verdict', 'y'], ['--help', '--contract', 'x']]) assert.equal(run(args).exitCode, 2);
  assert.equal(run(['--help']).exitCode, 0);
});

test('invalid UTF-8 is rejected instead of silently replacing bytes', () => {
  const dir = sandbox(), file = path.join(dir, 'invalid-utf8.json');
  fs.writeFileSync(file, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  assert.equal(run(['--contract', file]).report.diagnostics[0].code, 'INVALID_JSON');
});
test('FIFO input is rejected without blocking or waiting for a writer', () => {
  const dir = sandbox(), fifo = path.join(dir, 'input-fifo');
  const made = spawnSync('mkfifo', [fifo], {encoding: 'utf8'}); assert.equal(made.status, 0, made.stderr);
  const proc = spawnSync(process.execPath, [fileURLToPath(new URL('./contract-check.mjs', import.meta.url)), '--contract', fifo], {encoding: 'utf8', timeout: 3000});
  assert.equal(proc.status, 2, proc.stderr); assert.equal(JSON.parse(proc.stdout).diagnostics[0].code, 'NOT_REGULAR_FILE');
});

test('real, symlink script and symlink directory CLI paths execute help, valid and malformed input', () => {
  const dir = sandbox(), real = fileURLToPath(new URL('./contract-check.mjs', import.meta.url));
  const fileLink = path.join(dir, 'entry.mjs'), dirLink = path.join(dir, 'scripts');
  fs.symlinkSync(real, fileLink); fs.symlinkSync(path.dirname(real), dirLink, 'dir');
  const valid = write(dir, 'contract.json', fixture().contract), broken = path.join(dir, 'broken.json'); fs.writeFileSync(broken, '{');
  for (const cli of [real, fileLink, path.join(dirLink, 'contract-check.mjs')]) {
    for (const [args, code, property] of [[['--help'], 0, 'usage'], [['--contract', valid], 0, 'status'], [['--contract', broken], 2, 'status']]) {
      const p = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 3000});
      assert.equal(p.status, code, p.stderr); assert.ok(JSON.parse(p.stdout)[property]);
    }
  }
});
test('import through a symlink directory never executes CLI output or sets an exit error', () => {
  const dir = sandbox(), link = path.join(dir, 'scripts'); fs.symlinkSync(fileURLToPath(new URL('.', import.meta.url)), link, 'dir');
  const wrapper = path.join(dir, 'importer.mjs'); fs.writeFileSync(wrapper, 'import "./scripts/contract-check.mjs";');
  const p = spawnSync(process.execPath, [wrapper], {encoding: 'utf8', timeout: 3000});
  assert.equal(p.status, 0); assert.equal(p.stdout, ''); assert.equal(p.stderr, '');
});
