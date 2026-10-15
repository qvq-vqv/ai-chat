import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {runCLI} from './relay-cli.mjs';

// ---------------------------------------------------------------------------
// Identity-verified discovery of an existing WorkBuddy desktop conversation.
//
// The session registry (~/.workbuddy-ai/sessions/<pid>.json) is volatile: the
// `endpoint` field is frequently absent while the ACP server is listening, the
// same UUID can have several records, and PIDs are reused. Selecting a port by
// heartbeat or by "the first port that answers" is therefore unsafe. Discovery
// binds a registration record to an observed process identity and refuses when
// that binding is not unique or not consistent.
//
// Approved target working directory is an INPUT. A candidate record must never
// prove its own scope, so callers supply the expected cwd from a binding.
// ---------------------------------------------------------------------------

const UUID_RE=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
const DEFAULT_BUNDLE_ID='com.workbuddy.workbuddy-ai';
const DEFAULT_START_TOLERANCE_SECONDS=2;

export const normalizePath=p=>String(p??'').replace(/\\/g,'/').replace(/\/+$/,'');

function trustedOrigin(value) {
 const u=new URL(value);
 if(u.protocol!=='http:'||!LOOPBACK_HOSTS.has(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Untrusted WorkBuddy session endpoint');
 return u;
}

const MONTHS={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const LSTART_RE=/^([A-Z][a-z]{2})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

// Parse `ps -o lstart=` output, which is `%a %b %e %H:%M:%S %Y` under
// LC_ALL=C (BSD ps space-pads single-digit days). The child is run with
// TZ=UTC, so the emitted wall clock IS UTC and Date.UTC is the right inverse.
// Anything unexpected returns null, which blocks the target.
export function parseProcessStartText(text) {
 if(typeof text!=='string')return null;
 const m=LSTART_RE.exec(text.trim());
 if(!m)return null;
 const month=MONTHS[m[2]];
 if(month===undefined)return null;
 const value=Date.UTC(Number(m[7]),month,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]))/1000;
 return Number.isFinite(value)?value:null;
}

function run(command,args,{encoding='utf8',env}={}) {
 return execFileSync(command,args,{encoding,timeout:8000,stdio:['ignore','pipe','ignore'],...(env?{env}:{})});
}

function lsofLines(runner,args) {
 try {return runner('lsof',args);}
 catch(error) {
  if(error&&error.code==='ENOENT')throw new Error('LSOF_UNAVAILABLE: lsof is required to verify WorkBuddy process identity');
  // lsof exits non-zero when nothing matches; partial stdout is still usable.
  return (error&&typeof error.stdout==='string')?error.stdout:'';
 }
}

// ---------------------------------------------------------------------------
// System identity probe. Every method is read-only and never returns a secret.
// `exec` and `kill` are injectable so isolated tests can exercise success and
// failure modes without touching a real process.
// ---------------------------------------------------------------------------

export function createSystemProbe({exec,kill}={}) {
 const invoke=exec||run;
 const signal=kill||((pid,sig)=>process.kill(pid,sig));
 return {
  // ALIVE / DEAD (ESRCH) / UNVERIFIABLE (EPERM or any other error). The
  // UNVERIFIABLE case is never treated as dead and never treated as verified.
  pidStatus(pid) {
   try {signal(pid,0);return 'ALIVE';}
   catch(error) {
    if(error.code==='ESRCH')return 'DEAD';
    return 'UNVERIFIABLE';
   }
  },
  pidCwd(pid) {
   const out=lsofLines(invoke,['-a','-p',String(pid),'-d','cwd','-Fn']);
   for(const line of out.split('\n'))if(line.startsWith('n'))return line.slice(1);
   return null;
  },
  pidExecutable(pid) {
   const out=lsofLines(invoke,['-a','-p',String(pid),'-d','txt','-Fn']);
   for(const line of out.split('\n'))if(line.startsWith('n'))return line.slice(1);
   return null;
  },
  // ppid/pgid/uid/login/command form a per-process fingerprint that survives
  // the endpoint field being absent and makes PID reuse detectable.
  pidFingerprint(pid) {
   const out=lsofLines(invoke,['-a','-p',String(pid),'-d','cwd','-FpRgLuc']);
   const fp={};
   for(const line of out.split('\n')) {
    if(!line)continue;
    const key=line[0],value=line.slice(1);
    if(key==='p')fp.pid=Number(value);
    else if(key==='R')fp.ppid=Number(value);
    else if(key==='g')fp.pgid=Number(value);
    else if(key==='u')fp.uid=Number(value);
    else if(key==='L')fp.login=value;
    else if(key==='c')fp.command=value;
   }
   return Number.isInteger(fp.pid)?fp:null;
  },
  // Only ports owned by THIS pid, and only loopback listeners.
  pidListenPorts(pid) {
   const out=lsofLines(invoke,['-a','-p',String(pid),'-iTCP','-sTCP:LISTEN','-Fn']);
   const ports=new Set();
   for(const line of out.split('\n')) {
    if(!line.startsWith('n'))continue;
    const m=/^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/.exec(line.slice(1));
    if(m)ports.add(Number(m[2]));
   }
   return [...ports];
  },
  // OS-provided process start time via `ps -o lstart=`, pinned to LC_ALL=C and
  // TZ=UTC so the text form and timezone are both explicit. Second precision.
  // The process disappearing, insufficient permission, a missing binary, or any
  // unexpected output all return null, which blocks the target.
  pidStartTime(pid) {
   try {
    const out=invoke('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C',TZ:'UTC'}});
    return parseProcessStartText(out);
   } catch {return null;}
  },
  // Birthtime of the registration file, created by the worker at startup.
  // Measured basis: |birthtime - startedAt/1000| was <= 0.642s over the four
  // live records sampled on this machine, so the tolerance below is ~3x margin.
  fileBirthtime(file) {
   try {
    const value=Number(String(invoke('stat',['-f','%B',file])).trim());
    return Number.isFinite(value)&&value>0?value:null;
   } catch {return null;}
  },
  // realpath the executable and confirm it is the installed app's declared
  // CFBundleExecutable for the expected bundle identifier. A path prefix, a
  // bundle name, or a generic node/Electron process is NOT sufficient.
  verifyAppExecutable(exePath,{expectedBundleId=DEFAULT_BUNDLE_ID}={}) {
   let real;
   try {real=fs.realpathSync(exePath);}
   catch {return {ok:false,reason:'EXE_UNRESOLVABLE'};}
   const m=/^(.*\.app)\/Contents\/MacOS\/([^/]+)$/.exec(real);
   if(!m)return {ok:false,reason:'EXE_NOT_IN_APP_BUNDLE',real};
   const appRoot=m[1],exeName=m[2],plist=path.join(appRoot,'Contents','Info.plist');
   if(!fs.existsSync(plist))return {ok:false,reason:'APP_PLIST_MISSING',real};
   let bundleId=null,declaredExe=null;
   try {bundleId=String(invoke('plutil',['-extract','CFBundleIdentifier','raw',plist])).trim();} catch {}
   try {declaredExe=String(invoke('plutil',['-extract','CFBundleExecutable','raw',plist])).trim();} catch {}
   if(!bundleId||!declaredExe)return {ok:false,reason:'APP_PLIST_UNREADABLE',real};
   if(bundleId!==expectedBundleId)return {ok:false,reason:'BUNDLE_ID_MISMATCH',real,bundleId};
   if(exeName!==declaredExe)return {ok:false,reason:'EXE_NAME_MISMATCH',real,bundleId,declaredExe};
   return {ok:true,real,app_root:appRoot,bundle_id:bundleId,declared_exe:declaredExe};
  },
 };
}

// ---------------------------------------------------------------------------
// Identity verification
// ---------------------------------------------------------------------------

export function verifyIdentity(record,{expectedCwd,probe,expectedBundleId=DEFAULT_BUNDLE_ID}={}) {
 const reject=reason=>({ok:false,reason});
 const pid=record?.pid;
 if(!Number.isInteger(pid)||pid<=0)return reject('PID_MISSING');

 // Distinguish "definitely gone" from "cannot be inspected"; never guess.
 const status=probe.pidStatus(pid);
 if(status==='DEAD')return reject('PID_DEAD');
 if(status!=='ALIVE')return reject('PID_UNVERIFIABLE');

 const rawCwd=probe.pidCwd(pid);
 if(!rawCwd)return reject('CWD_UNREADABLE');
 const processCwd=normalizePath(rawCwd),registrationCwd=normalizePath(record.cwd);
 if(!registrationCwd)return reject('REGISTRATION_CWD_MISSING');
 if(processCwd!==registrationCwd)return reject('CWD_MISMATCH');
 // Scope comes from the approved binding, never from the candidate itself.
 if(normalizePath(expectedCwd)!==registrationCwd)return reject('OUT_OF_TARGET_SCOPE');

 const rawExe=probe.pidExecutable(pid);
 if(!rawExe)return reject('EXE_UNREADABLE');
 const app=probe.verifyAppExecutable(rawExe,{expectedBundleId});
 if(!app.ok)return reject(app.reason);

 const ports=(probe.pidListenPorts(pid)||[]).filter(Number.isInteger);
 if(!ports.length)return reject('NO_LISTEN_PORT');

 const fingerprint=probe.pidFingerprint(pid);
 if(!fingerprint)return reject('FINGERPRINT_UNREADABLE');

 return {ok:true,pid,cwd:processCwd,executable:app.real,bundle_id:app.bundle_id,ports,fingerprint};
}

// Process start identity.
//
// `startedAt` and the registration file's birthtime BOTH come from registration
// data, so their agreement only shows the registration is self-consistent. It
// cannot exclude PID reuse, so it is reported as `registration_consistent` and
// is NEVER a release basis.
//
// Releasing a target requires a real process start time obtained from the OS.
// When the platform refuses to expose one, `process_identity_verified` is false
// and the caller MUST block; the registration proxy is reported for the record
// only.
export function verifyStartIdentity(record,verified,probe,{tolerance=DEFAULT_START_TOLERANCE_SECONDS}={}) {
 const startedAt=Number(record?.startedAt);

 let registrationConsistent={checked:false};
 const birth=typeof probe.fileBirthtime==='function'?probe.fileBirthtime(record.file):null;
 if(Number.isFinite(startedAt)&&startedAt>0&&Number.isFinite(birth)&&birth>0) {
  const delta=birth-startedAt/1000;
  registrationConsistent={checked:true,basis:'registration_file_birthtime',source:'stat -f %B',delta_seconds:Number(delta.toFixed(3)),tolerance_seconds:tolerance,consistent:Math.abs(delta)<=tolerance,note:'registration self-consistency only; not a release basis'};
 }

 const processStart=typeof probe.pidStartTime==='function'?probe.pidStartTime(verified.pid):null;
 if(!Number.isFinite(processStart)||processStart<=0)
  return {process_identity_verified:false,basis:'unavailable',reason:'PROCESS_START_TIME_UNAVAILABLE',registration_consistent:registrationConsistent};
 if(!Number.isFinite(startedAt)||startedAt<=0)
  return {process_identity_verified:false,basis:'unavailable',reason:'REGISTRATION_STARTED_AT_MISSING',process_start_time:processStart,registration_consistent:registrationConsistent};

 const delta=processStart-startedAt/1000;
 if(!(Math.abs(delta)<=tolerance))throw new Error('START_TIME_MISMATCH: process start time differs from registration startedAt by '+delta.toFixed(3)+'s (tolerance '+tolerance+'s)');
 return {process_identity_verified:true,basis:'process_start_time',source:'ps -p <pid> -o lstart= (LC_ALL=C, TZ=UTC; second precision)',process_start_time:processStart,delta_seconds:Number(delta.toFixed(3)),tolerance_seconds:tolerance,registration_consistent:registrationConsistent};
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function discoverSession(configDir,endpoint,options={}) {
 if(!UUID_RE.test(endpoint||''))throw new Error('Exact WorkBuddy desktop conversation UUID required');
 const expectedCwd=normalizePath(options.expectedCwd);
 if(!expectedCwd)throw new Error('EXPECTED_CWD_REQUIRED: supply the approved target working directory so identity is bound to a known scope');
 const probe=options.probe||createSystemProbe();
 const expectedBundleId=options.expectedBundleId||DEFAULT_BUNDLE_ID;
 const startTolerance=Number.isFinite(Number(options.startToleranceSeconds))?Number(options.startToleranceSeconds):DEFAULT_START_TOLERANCE_SECONDS;

 const dir=path.join(configDir,'sessions');
 if(!fs.existsSync(dir))throw new Error('TARGET_NOT_ACTIVE: WorkBuddy session registry absent');

 // Registration metadata only; no other project's ports are ever enumerated.
 const readRegistry=()=>{
  const records=[];
  for(const name of fs.readdirSync(dir).filter(n=>/^\d+\.json$/.test(n))) {
   let r;try {r=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));} catch {continue;}
   if(r.kind!=='interactive'||r.sessionId!==endpoint)continue;
   records.push({...r,file:path.join(dir,name)});
  }
  return records;
 };

 const before=readRegistry();
 if(!before.length)throw new Error('TARGET_NOT_ACTIVE: designated desktop conversation has no active backend worker');

 const passed=[],rejected=[];
 for(const record of before) {
  const verified=verifyIdentity(record,{expectedCwd,probe,expectedBundleId});
  if(!verified.ok) {rejected.push({pid:record.pid,file:record.file,reason:verified.reason});continue;}
  // A registered endpoint is only a hint. When present it must be loopback,
  // trusted, and already owned by the same verified process.
  let ports=[...verified.ports];
  if(record.endpoint!=null&&record.endpoint!=='') {
   const u=trustedOrigin(record.endpoint);
   if(!ports.includes(Number(u.port))) {rejected.push({pid:record.pid,file:record.file,reason:'ENDPOINT_PORT_NOT_OWNED'});continue;}
   ports=[Number(u.port)];
  }
  passed.push({record,verified,ports});
 }

 if(!passed.length)throw new Error('IDENTITY_UNVERIFIED: no registration candidate passed identity verification; refusing to guess the ACP port. '+JSON.stringify(rejected));

 // Never pick a winner by heartbeat. Multiple verified processes are ambiguous.
 const distinctPids=[...new Set(passed.map(p=>p.verified.pid))];
 if(distinctPids.length>1)throw new Error('REFUSE_AMBIGUOUS: '+distinctPids.length+' distinct processes passed identity verification (pid='+distinctPids.join(',')+'); refusing to choose');

 const chosen=passed[0];
 // Multiple listener ports on one verified process: refuse rather than guess
 // which one speaks ACP.
 if(chosen.ports.length!==1)throw new Error('REFUSE_AMBIGUOUS: verified process owns '+chosen.ports.length+' loopback listener ports ('+chosen.ports.join(',')+'); refusing to guess the ACP port');
 const port=chosen.ports[0],origin='http://127.0.0.1:'+port;

 // Re-read registration and re-verify identity: handles prewarm promotion and
 // PID reuse that could land between the first read and the handshake.
 const after=readRegistry().find(r=>r.pid===chosen.verified.pid&&r.sessionId===endpoint);
 if(!after)throw new Error('IDENTITY_CHANGED: registration for the verified process disappeared during verification');
 for(const key of ['pid','sessionId','kind','cwd','startedAt','endpoint']) {
  if(String(after[key]??'')!==String(chosen.record[key]??''))throw new Error('IDENTITY_CHANGED: registration field "'+key+'" changed during verification');
 }
 const recheck=verifyIdentity(after,{expectedCwd,probe,expectedBundleId});
 if(!recheck.ok)throw new Error('IDENTITY_CHANGED: re-verification failed ('+recheck.reason+')');
 if(recheck.cwd!==chosen.verified.cwd)throw new Error('IDENTITY_CHANGED: process cwd changed during verification');
 if(JSON.stringify(recheck.fingerprint)!==JSON.stringify(chosen.verified.fingerprint))throw new Error('IDENTITY_CHANGED: process fingerprint changed during verification');
 if(!recheck.ports.includes(port))throw new Error('IDENTITY_CHANGED: verified listener port is no longer owned by the process');

 const startIdentity=verifyStartIdentity(after,recheck,probe,{tolerance:startTolerance});
 // A real process start identity is required to release. Without it the target
 // is reported as a candidate but never released, so PID reuse cannot slip
 // through on registration data alone.
 if(startIdentity.process_identity_verified!==true) {
  const error=new Error('PROCESS_IDENTITY_UNVERIFIED: real process start identity unavailable ('+startIdentity.reason+'); candidate reported but not released');
  error.code='PROCESS_IDENTITY_UNVERIFIED';
  error.candidate={origin,port,pid:recheck.pid,cwd:recheck.cwd,executable:recheck.executable,bundle_id:recheck.bundle_id,fingerprint:recheck.fingerprint,start_identity:startIdentity,rejected};
  throw error;
 }

 return {
  ...after,
  origin,
  port,
  identity:{
   pid:recheck.pid,
   cwd:recheck.cwd,
   executable:recheck.executable,
   bundle_id:recheck.bundle_id,
   fingerprint:recheck.fingerprint,
   port_owned_by_pid:true,
   endpoint_matches_owned_port:true,
   registration_reread_consistent:true,
   start_identity:startIdentity,
  },
  // Recorded as evidence only; it never influences selection.
  heartbeat_used_for_selection:false,
 };
}

export async function consumeRPC(response,id,onUpdate=()=>{}) {
 if(!response.ok)throw new Error('WorkBuddy ACP rejected request: HTTP '+response.status);
 const type=response.headers.get('content-type')||'';
 if(type.includes('application/json')) {
  const v=await response.json();if(v.id!==id||v.error||!Object.hasOwn(v,'result'))throw new Error('ACP result identity mismatch or error');return v.result;
 }
 if(!type.includes('text/event-stream'))throw new Error('Unexpected ACP content type');
 let buffer='';const decoder=new TextDecoder();
 for await(const chunk of response.body) {
  buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');
  let split;
  while((split=buffer.indexOf('\n\n'))>=0) {
   const event=buffer.slice(0,split);buffer=buffer.slice(split+2);
   const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
   if(!data)continue;const v=JSON.parse(data);
   if(v.method==='session/update')onUpdate(v.params);
   if(v.id===id) {if(v.error)throw new Error('WorkBuddy ACP RPC returned an error (code '+String(v.error.code)+')');if(Object.hasOwn(v,'result'))return v.result;}
   if(v.method==='session/request_permission')throw new Error('NEED_USER: WorkBuddy tool permission request; adapter does not approve it');
  }
  if(buffer.length>1024*1024)throw new Error('ACP frame too large');
 }
 throw new Error('ACP stream ended without matching final RPC result');
}

export function assertIdle(r,configDir,endpointId) {
 const key=r.cwd.replace(/\\/g,'/').replace(/^\//,'').replace(/\//g,'-');
 const transcript=path.join(configDir,'projects',key,endpointId+'.jsonl');
 if(!fs.existsSync(transcript))throw new Error('Cannot verify target idle: transcript unavailable');
 const fd=fs.openSync(transcript,'r');let tail;
 try{const size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,65536));fs.readSync(fd,b,0,b.length,size-b.length);tail=b.toString('utf8');}finally{fs.closeSync(fd);}
 const records=tail.split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}});
 const last=records.findLast(v=>v.status||['message','assistant','user','function_call'].includes(v.type)||v.type==='system'&&v.subtype==='turn_duration');
 if(!last||!(last.status==='completed'&&last.role==='assistant'||last.type==='system'&&last.subtype==='turn_duration'||last.type==='assistant'&&last.message?.stop_reason==='end_turn'))throw new Error('BUSY_OR_UNKNOWN: target has no verified idle terminal record');
 return transcript;
}

// ---------------------------------------------------------------------------
// Zero-credit gate
//
// Reads the model actually selected for the loaded session and its quoted
// price from THIS connection's session/load result. An absent, ambiguous, or
// non-zero quote blocks the prompt. An empty quote is never treated as free,
// and the adapter never switches the model itself.
// ---------------------------------------------------------------------------

export function assertZeroCreditQuote(loadResult) {
 const models=loadResult?.models;
 const modelId=models?.currentModelId;
 if(typeof modelId!=='string'||!modelId)throw new Error('ZERO_CREDIT_GATE: session/load did not report currentModelId; refusing to send prompt');
 const available=models?.availableModels;
 if(!Array.isArray(available)||!available.length)throw new Error('ZERO_CREDIT_GATE: session/load did not report availableModels; refusing to send prompt');
 const matches=available.filter(v=>v&&v.modelId===modelId);
 if(matches.length!==1)throw new Error('ZERO_CREDIT_GATE: expected exactly one availableModels entry for "'+modelId+'", found '+matches.length+'; refusing to send prompt');
 const credits=matches[0]._meta?.credits;
 if(credits!=='x0.00')throw new Error('ZERO_CREDIT_GATE: model "'+modelId+'" is quoted at '+JSON.stringify(credits??null)+', not "x0.00"; refusing to send prompt');
 return {model_id:modelId,credits,observed_at:new Date().toISOString(),source:'session/load',basis:'quote metadata only; not a billing deduction proof'};
}

export class WorkBuddySessionProvider {
 id='workbuddy-session';
 constructor(o={}) {
  this.configDir=o['config-dir']||path.join(os.homedir(),'.workbuddy-ai');
  this.fetch=o.fetch||fetch;
  this.expectedCwd=normalizePath(o['expected-cwd']);
  this.expectedBundleId=o['expected-bundle-id']||DEFAULT_BUNDLE_ID;
  this.startToleranceSeconds=Number.isFinite(Number(o['start-tolerance-seconds']))?Number(o['start-tolerance-seconds']):undefined;
  // Injectable for isolated tests; defaults to the read-only system probe.
  this.probe=o.probe;
 }
 discover(endpoint) {
  return discoverSession(this.configDir,endpoint,{expectedCwd:this.expectedCwd,probe:this.probe,expectedBundleId:this.expectedBundleId,startToleranceSeconds:this.startToleranceSeconds});
 }
 async connect(record) {
  const r=await this.fetch(record.origin+'/api/v1/acp/connect',{method:'POST',headers:{'x-codebuddy-request':'1'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('ACP connection unavailable: HTTP '+r.status);
  const v=await r.json();if(!v.connectionId)throw new Error('ACP connection missing identity');
  // Ephemeral credentials come from the native connection handshake, remain in memory,
  // and are never extracted from account stores or written to request state.
  return {'acp-connection-id':v.connectionId,...v.sessionToken?{'acp-session-token':v.sessionToken}:{}};
 }
 async rpc(record,headers,id,method,params,onUpdate) {
  const r=await this.fetch(record.origin+'/api/v1/acp',{method:'POST',headers:{...headers,'content-type':'application/json','accept':'application/json, text/event-stream','x-codebuddy-request':'1'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal:AbortSignal.timeout(method==='session/prompt'?180000:15000)});
  try{return await consumeRPC(r,id,onUpdate);}finally{await r.body?.cancel().catch(()=>{});}
 }
 // Desensitized quote evidence: model id, quoted price, and observation time.
 // Never contains credentials, tokens, or account identity.
 saveQuoteEvidence(state,quote) {
  if(typeof state?.reply_file!=='string'||!state.reply_file)return null;
  const file=state.reply_file+'.quote.json';
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(quote,null,2)+'\n',{mode:0o600});
  fs.renameSync(tmp,file);
  return file;
 }
 async preflight(endpoint) {
  const record=this.discover(endpoint);
  assertIdle(record,this.configDir,endpoint);
  // No health probe of other sessions, new CLI, or focus change.
  const headers=await this.connect(record);
  await this.rpc(record,headers,1,'initialize',{protocolVersion:1,clientInfo:{name:'ai-chat',version:'3.0.0'},clientCapabilities:{}});
  this.record=record;this.headers=headers;
  return {status:'PREFLIGHT_OK',endpoint_id:endpoint,transport:'desktop-local-acp',receive_mode:'matching prompt result and final envelope; active worker required',identity:{pid:record.identity.pid,cwd:record.identity.cwd,bundle_id:record.identity.bundle_id,start_identity:record.identity.start_identity}};
 }
 async deliver(state,message) {
  const r=this.discover(state.endpoint_id);
  if(r.pid!==this.record.pid||r.origin!==this.record.origin)throw new Error('Target worker changed before send');
  if(JSON.stringify(r.identity.fingerprint)!==JSON.stringify(this.record.identity?.fingerprint))throw new Error('Target process fingerprint changed before send');
  // The pre-dispatch fingerprint includes the real process start identity, so a
  // PID reused between preflight and delivery is detected here.
  if(r.identity.start_identity?.process_identity_verified!==true)throw new Error('Target process start identity is not verified before send');
  if(r.identity.start_identity.process_start_time!==this.record.identity?.start_identity?.process_start_time)throw new Error('Target process start identity changed before send');
  const transcript=assertIdle(r,this.configDir,state.endpoint_id);
  state.native_transcript=transcript;
  // A fresh ACP connection needs its own render loop. Loading the exact idle
  // existing session installs it; never takeWriter or evict another client.
  const loaded=await this.rpc(r,this.headers,2,'session/load',{sessionId:state.endpoint_id,cwd:r.cwd,mcpServers:[]});
  // Mandatory zero-credit gate: evaluated from this connection's load result,
  // before any model call, and blocking when the quote is absent or non-zero.
  let quote;
  try {quote=assertZeroCreditQuote(loaded);}
  catch(error) {
   // Durable marker so a blocked gate is never read as an uncertain delivery:
   // no prompt was sent, and the existing relay will report SEND_UNKNOWN only
   // because the provider refused to proceed.
   state.zero_credit_gate={decision:'BLOCK',prompt_sent:false,reason:error.message,observed_at:new Date().toISOString()};
   throw error;
  }
  state.zero_credit_gate={decision:'ALLOW',model_id:quote.model_id,credits:quote.credits,observed_at:quote.observed_at};
  state.zero_credit_quote=quote;
  state.quote_evidence_file=this.saveQuoteEvidence(state,quote);
  // Re-verify the exact target immediately before the model call.
  const recheck=this.discover(state.endpoint_id);
  if(recheck.pid!==r.pid||recheck.origin!==r.origin)throw new Error('Target worker changed during session load');
  if(JSON.stringify(recheck.identity.fingerprint)!==JSON.stringify(r.identity.fingerprint))throw new Error('Target process fingerprint changed during session load');
  if(recheck.identity.start_identity.process_start_time!==r.identity.start_identity.process_start_time)throw new Error('Target process start identity changed during session load');
  let text='';
  const result=await this.rpc(recheck,this.headers,3,'session/prompt',{sessionId:state.endpoint_id,prompt:[{type:'text',text:message}]},p=>{
   if(p?.sessionId!==state.endpoint_id)return;
   const u=p.update;if(u?.sessionUpdate==='agent_message_chunk'&&['text','output_text'].includes(u.content?.type))text+=u.content.text;
  });
  if(result.stopReason!=='end_turn')throw new Error('Native prompt did not finish normally');
  const matches=[...text.matchAll(/<ai-chat-response>\s*(\{[\s\S]*?\})\s*<\/ai-chat-response>/g)];
  if(matches.length!==1)throw new Error('Final native turn lacks one response envelope');
  const value=JSON.parse(matches[0][1]);
  const tmp=state.reply_file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(tmp,state.reply_file);
  return {transport:'desktop-local-acp',endpoint_id:state.endpoint_id,native_stop_reason:result.stopReason,zero_credit_quote:quote};
 }
 async poll(state) {
  if(!fs.existsSync(state.reply_file)) {
   if(!state.native_transcript||!fs.existsSync(state.native_transcript))return null;
   const base=fs.realpathSync(path.join(this.configDir,'projects')),actual=fs.realpathSync(state.native_transcript),rel=path.relative(base,actual);
   if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||path.basename(actual)!==state.endpoint_id+'.jsonl')throw new Error('Untrusted native transcript');
   const fd=fs.openSync(actual,'r');let tail;
   try{const size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,1024*1024));fs.readSync(fd,b,0,b.length,size-b.length);tail=b.toString('utf8');}finally{fs.closeSync(fd);}
   for(const line of tail.split('\n').reverse()) {
    let r;try{r=JSON.parse(line);}catch{continue;}
    if(r.sessionId!==state.endpoint_id||r.role!=='assistant'||r.status!=='completed')continue;
    const text=Array.isArray(r.content)?r.content.filter(c=>['text','output_text'].includes(c.type)).map(c=>c.text).join(''):'';
    const matches=[...text.matchAll(/<ai-chat-response>\s*(\{[\s\S]*?\})\s*<\/ai-chat-response>/g)];
    if(matches.length!==1)continue;
    let value;try{value=JSON.parse(matches[0][1]);}catch{continue;}
    if(value.request_id===state.request_id&&value.request_token===state.request_token)return value;
   }
   return null;
  }
  const rel=path.relative(fs.realpathSync(state.project_root),fs.realpathSync(state.reply_file));
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Reply file escapes project');
  return JSON.parse(fs.readFileSync(state.reply_file,'utf8'));
 }
}
await runCLI(import.meta.url,o=>new WorkBuddySessionProvider(o));
