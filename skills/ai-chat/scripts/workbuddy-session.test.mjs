import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {discoverSession,consumeRPC,assertZeroCreditQuote,createSystemProbe,parseProcessStartText,WorkBuddySessionProvider} from './workbuddy-session.mjs';

const target='33333333-3333-4333-8333-333333333333';
const cwd='/fixture';
const startedAt=1000000;          // ms -> 1000s
const processStart=1000;          // s
const APP_OK={ok:true,real:'/Applications/WorkBuddy AI.app/Contents/MacOS/Electron',app_root:'/Applications/WorkBuddy AI.app',bundle_id:'com.workbuddy.workbuddy-ai',declared_exe:'Electron'};
const fp=pid=>({pid,ppid:1,pgid:pid,uid:501,login:'fixture',command:'Electron'});
const FREE_LOAD={models:{currentModelId:'deepseek-v4.1-flash',availableModels:[{modelId:'deepseek-v4.1-flash',_meta:{credits:'x0.00'}}]}};

// Isolated, read-only process-identity fixture. No real process is touched.
// `startTime` is the real OS process start time; `birthtime` is registration
// data only and is never a release basis.
function fixtureProbe(byPid,{app=APP_OK,birthtime=null,startTime=processStart}={}) {
 return {
  pidStatus:pid=>byPid[pid]?.status??'DEAD',
  pidCwd:pid=>byPid[pid]?.cwd??null,
  pidExecutable:pid=>byPid[pid]?.exe??null,
  pidFingerprint:pid=>byPid[pid]?.fingerprint??null,
  pidListenPorts:pid=>byPid[pid]?.ports??[],
  pidStartTime:()=>startTime,
  fileBirthtime:()=>birthtime,
  verifyAppExecutable:()=>app,
 };
}
const live=(over={})=>({status:'ALIVE',cwd,exe:APP_OK.real,ports:[4444],fingerprint:fp(200),...over});

function registry(t,records) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-chat-wb-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'sessions'));
 for(const [name,value] of Object.entries(records))fs.writeFileSync(path.join(root,'sessions',name),JSON.stringify(value));
 return root;
}
const snapshot=root=>fs.readdirSync(path.join(root,'sessions')).sort().map(n=>n+':'+fs.readFileSync(path.join(root,'sessions',n),'utf8')).join('|');
const reg=(pid,over={})=>({pid,kind:'interactive',sessionId:target,cwd,startedAt,...over});

test('exact UUID, approved cwd and registered endpoint are required',t=>{
 const root=registry(t,{'123.json':reg(200,{endpoint:'http://127.0.0.1:4444'})});
 const probe=fixtureProbe({200:live()});
 assert.throws(()=>discoverSession(root,'not-a-uuid',{expectedCwd:cwd,probe}),/Exact WorkBuddy desktop conversation UUID/);
 // Approved cwd is an input; a candidate never proves its own scope.
 assert.throws(()=>discoverSession(root,target,{probe}),/EXPECTED_CWD_REQUIRED/);
 assert.throws(()=>discoverSession(root,target,{expectedCwd:'/other',probe}),/IDENTITY_UNVERIFIED/);
 assert.equal(discoverSession(root,target,{expectedCwd:cwd,probe}).origin,'http://127.0.0.1:4444');
});

test('discovery never substitutes another live desktop conversation',t=>{
 const root=registry(t,{'123.json':reg(200,{sessionId:'other',endpoint:'http://127.0.0.1:4444'})});
 const probe=fixtureProbe({200:live()});
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe}),/TARGET_NOT_ACTIVE/);
 for(const endpoint of ['https://remote.example:443','http://127.0.0.1:4444/?token=secret','http://user:pass@127.0.0.1:4444','http://10.0.0.9:4444']) {
  fs.writeFileSync(path.join(root,'sessions','123.json'),JSON.stringify(reg(200,{endpoint})));
  assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe}));
 }
 fs.writeFileSync(path.join(root,'sessions','124.json'),JSON.stringify(reg(201)));
 fs.writeFileSync(path.join(root,'sessions','123.json'),JSON.stringify(reg(200,{endpoint:'http://127.0.0.1:4444'})));
 assert.equal(discoverSession(root,target,{expectedCwd:cwd,probe}).origin,'http://127.0.0.1:4444');
});

test('identity resolves a record whose endpoint field is absent',t=>{
 // The live blocker: the worker listens on loopback but never writes `endpoint`.
 const root=registry(t,{'200.json':reg(200)});
 const hit=discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({ports:[55170]})})});
 assert.equal(hit.origin,'http://127.0.0.1:55170');
 assert.equal(hit.port,55170);
 assert.equal(hit.identity.port_owned_by_pid,true);
 assert.equal(hit.identity.endpoint_matches_owned_port,true);
 assert.equal(hit.heartbeat_used_for_selection,false);
});

test('dead, reused and out-of-scope candidates are rejected without deleting registrations',t=>{
 const root=registry(t,{'100.json':reg(100,{endpoint:'http://127.0.0.1:60025'}),'200.json':reg(200)});
 // ESRCH (dead) vs EPERM (unverifiable) must not be conflated.
 const probe=fixtureProbe({100:{status:'DEAD'},200:live({ports:[55170]})});
 const before=snapshot(root);
 assert.equal(discoverSession(root,target,{expectedCwd:cwd,probe}).pid,200);
 assert.equal(snapshot(root),before,'registration files must not be rewritten or deleted');

 // EPERM: the process exists but cannot be inspected -> refuse, never guess.
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({status:'UNVERIFIABLE'})})}),/IDENTITY_UNVERIFIED/);
 // cwd mismatch between registration and process.
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({cwd:'/somewhere-else'})})}),/IDENTITY_UNVERIFIED/);
 // Executable is not the verified installed WorkBuddy app.
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live()},{app:{ok:false,reason:'BUNDLE_ID_MISMATCH'}})}),/IDENTITY_UNVERIFIED/);
 // Endpoint present but not owned by the verified process.
 const root3=registry(t,{'200.json':reg(200,{endpoint:'http://127.0.0.1:60025'})});
 assert.throws(()=>discoverSession(root3,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({ports:[9999]})})}),/IDENTITY_UNVERIFIED/);
 assert.equal(snapshot(root),before);
});

test('multiple verified candidates and multiple owned ports are refused, not guessed',t=>{
 const root=registry(t,{'200.json':reg(200),'300.json':reg(300)});
 const both=fixtureProbe({200:live({ports:[4444]}),300:live({ports:[5555],fingerprint:fp(300)})});
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:both}),/REFUSE_AMBIGUOUS/);
 // One process, several loopback listeners: refuse rather than pick a port.
 fs.rmSync(path.join(root,'sessions','300.json'));
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({ports:[4444,5555]})})}),/REFUSE_AMBIGUOUS/);
});

test('identity changing between the two checks is refused',t=>{
 const root=registry(t,{'200.json':reg(200)});
 let calls=0;
 const probe=fixtureProbe({200:live({ports:[4444]})});
 probe.pidFingerprint=()=>fp(++calls===1?200:201);
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe}),/IDENTITY_CHANGED/);
 // Registration rewritten mid-flight (prewarm promotion) is also refused.
 const root2=registry(t,{'200.json':reg(200)});
 const probe2=fixtureProbe({200:live({ports:[4444]})});
 const realCwd=probe2.pidCwd;
 probe2.pidCwd=pid=>{fs.writeFileSync(path.join(root2,'sessions','200.json'),JSON.stringify(reg(200,{startedAt:2000000})));return realCwd(pid);};
 assert.throws(()=>discoverSession(root2,target,{expectedCwd:cwd,probe:probe2}),/IDENTITY_CHANGED/);
});

test('a real process start identity is required to release; registration data never releases',t=>{
 const root=registry(t,{'200.json':reg(200)});
 const base={200:live({ports:[4444]})};

 // Released only on a real OS process start time within tolerance.
 const released=discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe(base,{birthtime:1000,startTime:processStart})});
 const si=released.identity.start_identity;
 assert.equal(si.process_identity_verified,true);
 assert.equal(si.basis,'process_start_time');
 assert.equal(si.process_start_time,processStart);

 // Registration birthtime agreement alone is never a release basis.
 const noOs=fixtureProbe(base,{birthtime:1000,startTime:null});
 let blocked;
 try {discoverSession(root,target,{expectedCwd:cwd,probe:noOs});} catch(error) {blocked=error;}
 assert.ok(blocked,'a registration-only basis must not release the target');
 assert.match(blocked.message,/PROCESS_IDENTITY_UNVERIFIED/);
 assert.equal(blocked.code,'PROCESS_IDENTITY_UNVERIFIED');
 // The candidate is still reportable, and carries the registration-only proxy.
 assert.equal(blocked.candidate.origin,'http://127.0.0.1:4444');
 assert.equal(blocked.candidate.start_identity.process_identity_verified,false);
 assert.equal(blocked.candidate.start_identity.reason,'PROCESS_START_TIME_UNAVAILABLE');
 assert.equal(blocked.candidate.start_identity.registration_consistent.checked,true);
 assert.equal(blocked.candidate.start_identity.registration_consistent.consistent,true);
 assert.match(blocked.candidate.start_identity.registration_consistent.note,/not a release basis/);

 // With no registration proxy either, the proxy is explicitly reported unchecked.
 const noProxy=fixtureProbe(base,{birthtime:null,startTime:null});
 let noproxy;
 try {discoverSession(root,target,{expectedCwd:cwd,probe:noProxy});} catch(error) {noproxy=error;}
 assert.equal(noproxy.candidate.start_identity.registration_consistent.checked,false);
});

test('PID reuse is detected by the real process start identity',t=>{
 const root=registry(t,{'200.json':reg(200)});
 // Same pid, cwd, executable and port, but the OS start time belongs to another process.
 assert.throws(()=>discoverSession(root,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({ports:[4444]})},{startTime:9000})}),/START_TIME_MISMATCH/);
 // Registration startedAt missing cannot be corroborated -> blocked.
 const noStarted=registry(t,{'200.json':{pid:200,kind:'interactive',sessionId:target,cwd}});
 let blocked;
 try {discoverSession(noStarted,target,{expectedCwd:cwd,probe:fixtureProbe({200:live({ports:[4444]})})});} catch(error) {blocked=error;}
 assert.equal(blocked.code,'PROCESS_IDENTITY_UNVERIFIED');
 assert.equal(blocked.candidate.start_identity.reason,'REGISTRATION_STARTED_AT_MISSING');
});

test('process start time is parsed from an explicit UTC ps source',()=>{
 // Normal LC_ALL=C output.
 assert.equal(parseProcessStartText('Sat Oct 10 19:55:23 2026'),Date.UTC(2026,9,10,19,55,23)/1000);
 // BSD ps space-pads single-digit days.
 assert.equal(parseProcessStartText('Sat Oct  4 19:55:23 2026'),Date.UTC(2026,9,4,19,55,23)/1000);
 // The child is pinned to TZ=UTC, so the emitted wall clock IS UTC and the
 // epoch round-trips exactly.
 assert.equal(parseProcessStartText('Thu Jan  1 00:00:00 1970'),0);
 // Anything unexpected is not a start time.
 for(const bad of ['','   ','not a date','Sat Foo 10 19:55:23 2026','Sat Oct 10 19:55:23','Sat Oct 10 19:55:23 26','10 Oct 2026',null,undefined,42])
  assert.equal(parseProcessStartText(bad),null,'must reject '+JSON.stringify(bad));
});

test('missing, denied, malformed and unavailable process start times all block',()=>{
 const ok=createSystemProbe({exec:()=>'Sat Oct 10 19:55:23 2026'});
 assert.equal(ok.pidStartTime(22542),Date.UTC(2026,9,10,19,55,23)/1000);
 const fail=code=>createSystemProbe({exec:()=>{const error=new Error(code);error.code=code;throw error;}});
 for(const [label,code] of [['process disappeared','ESRCH'],['permission denied','EPERM'],['binary unavailable','ENOENT']])
  assert.equal(fail(code).pidStartTime(22542),null,label+' must block');
 assert.equal(createSystemProbe({exec:()=>'???'}).pidStartTime(22542),null,'malformed output must block');
 assert.equal(createSystemProbe({exec:()=>''}).pidStartTime(22542),null,'empty output must block');
});

test('the real probe releases a target once ps reports a matching start time',t=>{
 const root=registry(t,{'200.json':reg(200)});
 // startedAt 1000000 ms == 1000 s, which is 1970-01-01T00:16:40Z.
 const exec=(command,args)=>{
  if(command==='lsof') {
   const fd=args.indexOf('-d')>=0?args[args.indexOf('-d')+1]:null;
   if(fd==='cwd')return 'p200\ng200\nR1\ncElectron\nu501\nLfixture\nfcwd\nn'+cwd+'\n';
   if(fd==='txt')return 'p200\nn'+APP_OK.real+'\n';
   return 'p200\nnlocalhost:4444\n';
  }
  if(command==='/bin/ps')return 'Thu Jan  1 00:16:40 1970\n';
  if(command==='plutil')return args[1]==='CFBundleIdentifier'?'com.workbuddy.workbuddy-ai\n':'Electron\n';
  if(command==='stat')return '1000\n';
  throw new Error('unexpected command '+command);
 };
 const hit=discoverSession(root,target,{expectedCwd:cwd,probe:createSystemProbe({exec,kill:()=>{}})});
 assert.equal(hit.origin,'http://127.0.0.1:4444');
 assert.equal(hit.identity.start_identity.process_identity_verified,true);
 assert.equal(hit.identity.start_identity.process_start_time,1000);
 assert.match(hit.identity.start_identity.source,/lstart=/);
 assert.doesNotMatch(hit.identity.start_identity.source,/sysctl/);
});

test('process liveness separates ESRCH from EPERM through the injectable signal',()=>{
 const alive=createSystemProbe({kill:()=>{}});
 assert.equal(alive.pidStatus(200),'ALIVE');
 const dead=createSystemProbe({kill:()=>{const e=new Error('ESRCH');e.code='ESRCH';throw e;}});
 assert.equal(dead.pidStatus(200),'DEAD');
 const denied=createSystemProbe({kill:()=>{const e=new Error('EPERM');e.code='EPERM';throw e;}});
 assert.equal(denied.pidStatus(200),'UNVERIFIABLE');
});

test('SSE parser waits for exact RPC result across split chunks',async()=>{
 const messages=[{jsonrpc:'2.0',method:'session/update',params:{sessionId:target,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}},{jsonrpc:'2.0',id:77,result:{stopReason:'end_turn'}},{jsonrpc:'2.0',id:2,result:{stopReason:'end_turn'}}];
 const bytes=new TextEncoder().encode(messages.map(v=>'data: '+JSON.stringify(v)+'\r\n\r\n').join(''));
 const stream=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}});
 let updates=0;assert.equal((await consumeRPC(new Response(stream,{headers:{'content-type':'text/event-stream'}}),2,()=>updates++)).stopReason,'end_turn');assert.equal(updates,1);
});

test('old result and EOF do not count as a finished turn; tool approval is not granted',async()=>{
 for(const value of [{id:9,result:{}},{method:'session/request_permission',params:{}}]) {
  const response=new Response('data: '+JSON.stringify(value)+'\n\n',{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(consumeRPC(response,2));
 }
});

test('zero-credit gate releases only on a unique exact x0.00 quote',()=>{
 const load=(currentModelId,availableModels)=>({models:{currentModelId,availableModels}});
 const free=assertZeroCreditQuote(load('deepseek-v4.1-flash',[{modelId:'deepseek-v4.1-flash',_meta:{credits:'x0.00'}},{modelId:'hy4-preview',_meta:{credits:'x0.29'}}]));
 assert.equal(free.model_id,'deepseek-v4.1-flash');
 assert.equal(free.credits,'x0.00');
 for(const bad of [
  load('hy4-preview',[{modelId:'hy4-preview',_meta:{credits:'x0.29'}}]),                 // non-zero
  load('hy3',[{modelId:'hy3',_meta:{credits:''}}]),                                      // empty quote is not free
  load('hy3',[{modelId:'hy3'}]),                                                          // missing quote
  load('hy3',[]),                                                                         // empty catalog
  load('hy3',[{modelId:'hy3',_meta:{credits:'x0.00'}},{modelId:'hy3',_meta:{credits:'x0.00'}}]), // ambiguous
  {models:{availableModels:[{modelId:'hy3',_meta:{credits:'x0.00'}}]}},                   // no current model
  {},
 ]) assert.throws(()=>assertZeroCreditQuote(bad),/ZERO_CREDIT_GATE/);
});

test('interrupted receiver recovers only native completed response for exact nonce',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-chat-wb-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'projects','test');fs.mkdirSync(dir,{recursive:true});
 const transcript=path.join(dir,target+'.jsonl'),replyFile=path.join(root,'reply.json');
 const state={project_root:root,native_transcript:transcript,reply_file:replyFile,endpoint_id:target,request_id:'r',request_token:'nonce'};
 const value={request_id:'r',request_token:'nonce',final:true};
 const record={sessionId:target,role:'assistant',status:'in_progress',content:[{type:'text',text:'<ai-chat-response>'+JSON.stringify(value)+'</ai-chat-response>'}]};
 const provider=new WorkBuddySessionProvider({'config-dir':root});
 fs.writeFileSync(transcript,JSON.stringify(record)+'\n');assert.equal(await provider.poll(state),null);
 record.status='completed';fs.writeFileSync(transcript,JSON.stringify(record)+'\n');assert.deepEqual(await provider.poll(state),value);
 state.request_token='new';assert.equal(await provider.poll(state),null);
});

// Shared setup for the delivery tests: an idle fixture target with a verified
// process start identity.
function deliverFixture(t,label='load') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-chat-wb-'+label+'-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'projects','fixture'),{recursive:true});fs.mkdirSync(path.join(root,'sessions'));
 fs.writeFileSync(path.join(root,'sessions','200.json'),JSON.stringify(reg(200)));
 fs.writeFileSync(path.join(root,'projects','fixture',target+'.jsonl'),JSON.stringify({role:'assistant',status:'completed'})+'\n');
 const probe=fixtureProbe({200:live({ports:[4444]})});
 const provider=new WorkBuddySessionProvider({'config-dir':root,'expected-cwd':cwd,probe});
 provider.record=provider.discover(target);provider.headers={};
 return {root,provider,probe};
}

test('fresh desktop connection loads exact session before prompt, never takes the writer, and stops on conflict',async t=>{
 const {root,provider}=deliverFixture(t);
 const calls=[],state={endpoint_id:target,reply_file:path.join(root,'reply.json')};
 provider.rpc=async(r,h,id,method,params,onUpdate)=>{
  calls.push({method,params});
  if(method==='session/load')return FREE_LOAD;
  if(method==='session/prompt') {onUpdate({sessionId:target,update:{sessionUpdate:'agent_message_chunk',content:{type:'output_text',text:'<ai-chat-response>{"reply":"ok"}</ai-chat-response>'}}});return {stopReason:'end_turn'};}
  return {};
 };
 const receipt=await provider.deliver(state,'hello');
 assert.deepEqual(calls.map(v=>v.method),['session/load','session/prompt']);
 assert.deepEqual(calls[0].params,{sessionId:target,cwd,mcpServers:[]});
 assert.equal('takeWriter' in calls[0].params,false,'session/load must never take the desktop writer');
 assert.equal(calls[1].params.sessionId,target);
 assert.equal(receipt.zero_credit_quote.credits,'x0.00');
 // Desensitized quote evidence is persisted next to the reply file.
 assert.equal(JSON.parse(fs.readFileSync(state.reply_file+'.quote.json','utf8')).credits,'x0.00');
 // Writer conflict during load stops before any prompt.
 calls.length=0;provider.rpc=async(r,h,id,method,params)=>{calls.push(method);throw new Error('writer conflict');};
 await assert.rejects(provider.deliver(state,'hello'),/writer conflict/);
 assert.deepEqual(calls,['session/load']);
});

test('non-zero or missing quote blocks the prompt and records that nothing was sent',async t=>{
 for(const [label,load] of [
  ['priced',{models:{currentModelId:'hy4-preview',availableModels:[{modelId:'hy4-preview',_meta:{credits:'x0.29'}}]}}],
  ['unquoted',{models:{currentModelId:'hy3',availableModels:[{modelId:'hy3',_meta:{credits:''}}]}}],
  ['unknown',{}],
 ]) {
  const {root,provider}=deliverFixture(t,label);
  const calls=[],state={endpoint_id:target,reply_file:path.join(root,label+'.reply.json')};
  provider.rpc=async(r,h,id,method,params)=>{calls.push(method);return method==='session/load'?load:{};};
  await assert.rejects(provider.deliver(state,'hello'),/ZERO_CREDIT_GATE/);
  assert.deepEqual(calls,['session/load'],label+': the model must never be called');
  assert.equal(state.zero_credit_gate.decision,'BLOCK');
  assert.equal(state.zero_credit_gate.prompt_sent,false);
  assert.equal(fs.existsSync(state.reply_file),false);
 }
});

test('process start identity changing before or during dispatch blocks the send',async t=>{
 // A start time inside the tolerance band but different from the one recorded at
 // preflight still blocks: the pre-dispatch fingerprint must match exactly.
 {
  const {root,provider,probe}=deliverFixture(t,'pre');
  probe.pidStartTime=()=>processStart+1;
  const state={endpoint_id:target,reply_file:path.join(root,'pre.reply.json')};
  provider.rpc=async(r,h,id,method,params)=>method==='session/load'?FREE_LOAD:{stopReason:'end_turn'};
  await assert.rejects(provider.deliver(state,'hello'),/start identity changed before send/);
  assert.equal(fs.existsSync(state.reply_file),false);
 }
 // Changed between the session load and the prompt: the first discovery inside
 // deliver still matches, the post-load discovery does not.
 {
  const {root,provider,probe}=deliverFixture(t,'during');
  let calls=0;
  probe.pidStartTime=()=>++calls<=1?processStart:processStart+1;
  const state={endpoint_id:target,reply_file:path.join(root,'during.reply.json')};
  provider.rpc=async(r,h,id,method,params)=>method==='session/load'?FREE_LOAD:{stopReason:'end_turn'};
  await assert.rejects(provider.deliver(state,'hello'),/start identity changed during session load/);
  assert.equal(fs.existsSync(state.reply_file),false);
 }
});
