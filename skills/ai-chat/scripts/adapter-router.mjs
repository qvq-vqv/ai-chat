import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../adapters');
const CORE = ['send', 'receive', 'request_correlation', 'final_detection', 'recover', 'project_isolation'];
export function loadAdapters(directories = []) {
  const result = [];
  for (const dir of [BUILTINS, ...directories]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
      const source = path.resolve(dir, file);
      const a = JSON.parse(fs.readFileSync(source, 'utf8'));
      if (a.schema_version !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id || '') ||
          !a.target_app || !['existing-session', 'resumed-cli', 'local-assistant', 'api'].includes(a.mode) ||
          !Array.isArray(a.caller_requires) || a.caller_requires.some(v => typeof v !== 'string') ||
          !a.capabilities || typeof a.skill !== 'string' ||
          !['builtin', 'skill'].includes(a.implementation)) throw new Error(`Invalid adapter manifest: ${source}`);
      if (a.implementation === 'builtin' && path.dirname(source) !== BUILTINS) throw new Error('External manifests cannot claim builtin execution');
      if (result.some(v => v.id === a.id)) throw new Error(`Duplicate adapter ID: ${a.id}`);
      const skill = path.resolve(path.dirname(source), a.skill);
      const entry = typeof a.entry === 'string' ? path.resolve(path.dirname(source), a.entry) : null;
      result.push({ ...a, source, skill, entry, resources_present: fs.existsSync(skill) && (a.implementation !== 'builtin' || !!entry && fs.existsSync(entry)) });
    }
  }
  return result;
}
export function planConnection(endpoint, adapters = loadAdapters()) {
  if (!endpoint || typeof endpoint.app !== 'string' || !endpoint.app.trim()) return { status: 'NEED_USER', missing: ['app: actual software, not model name'] };
  if (!['existing-session', 'resumed-cli', 'local-assistant', 'api'].includes(endpoint.mode)) return { status: 'NEED_USER', missing: ['mode: existing-session | resumed-cli | local-assistant | api'] };
  const capabilities = new Set(endpoint.caller_capabilities || []);
  const candidates = adapters.filter(a => a.target_app.toLowerCase() === endpoint.app.toLowerCase() && a.mode === endpoint.mode)
    .filter(a => !endpoint.adapter_id || a.id === endpoint.adapter_id);
  const eligible = candidates.filter(a => (!a.fixed_endpoint_id || !endpoint.session_id || a.fixed_endpoint_id === endpoint.session_id) && a.resources_present && CORE.every(c => a.capabilities[c] === true) &&
    (endpoint.mode !== 'existing-session' || a.capabilities.existing_session === true) &&
    a.caller_requires.every(c => capabilities.has(c)));
  if (!eligible.length) return { status: 'UNSUPPORTED', reason: 'No installed adapter satisfies this exact app, mode and caller capability set', candidates: candidates.map(a => ({ id: a.id, resources_present: a.resources_present, missing_capabilities: CORE.filter(c => a.capabilities[c] !== true), caller_requires: a.caller_requires, fixed_endpoint_id: a.fixed_endpoint_id || null })) };
  if (eligible.length > 1) return { status: 'NEED_USER', reason: 'Multiple eligible adapters; choose explicitly', candidates: eligible.map(a => a.id) };
  const adapter = eligible[0];
  if (adapter.requires_receive_consent && endpoint.receive_mode_confirmed !== true) return { status: 'NEED_USER', missing: ['Confirm cooperative final-record receive mode and its limitations'], adapter };
  if (endpoint.mode !== 'api' && !endpoint.session_id) return { status: 'NEED_USER', missing: ['session_id'], adapter };
  if (endpoint.mode === 'api' && (!endpoint.model || !endpoint.api_authorized)) return { status: 'NEED_USER', missing: ['explicit model and API data/billing authorization'], adapter };
  return { status: 'CANDIDATE', adapter, next: 'Read adapter skill, verify local prerequisites and confirmed binding, then perform authorized live handshake. Manifest claims do not prove connectivity.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const directories = []; let endpoint;
    for (let i=0;i<args.length;i++) {
      if (args[i] === '--registry' && args[i+1]) directories.push(path.resolve(args[++i]));
      else if (args[i] === '--endpoint' && args[i+1]) endpoint = JSON.parse(fs.readFileSync(args[++i], 'utf8'));
      else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    }
    const adapters = loadAdapters(directories);
    if (!['list', 'plan'].includes(command)) throw new Error('Usage: adapter-router.mjs list|plan [--registry DIR] [--endpoint JSON_FILE]');
    console.log(JSON.stringify(command === 'list' ? adapters : planConnection(endpoint, adapters), null, 2));
  } catch (error) { console.error(JSON.stringify({status:'ERROR',error:error.message})); process.exitCode=1; }
}
