import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {validateFinal} from './relay-core.mjs';

export const ADAPTER = 'codebuddy-resident';
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const inside = (file, root) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
export function checkedPath(file, root) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('INVALID_PATH');
  const resolved = path.resolve(file);
  if (!inside(resolved, root)) throw Error('PATH_OUTSIDE_PROJECT');
  let current = resolved;
  while (inside(current, root)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('SYMLINK_REJECTED');
    if (current === root) break;
    current = path.dirname(current);
  }
  if (fs.existsSync(resolved) && !inside(fs.realpathSync(resolved), root)) throw Error('PATH_OUTSIDE_PROJECT');
  return resolved;
}
export function loadBinding(file, {expiredOK = false} = {}) {
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('INVALID_BINDING_FILE');
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>131072)throw Error('INVALID_BINDING_FILE');
  let b;try{b=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('INVALID_BINDING_JSON');}
  const keys=new Set(['schema_version','authorized','project_root','project_id','endpoint_id','runtime_dir','workspace','cli_entry','config_dir','model','expires_at','allow_create_session','run_timeout_ms','require_zero_credits']);
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.has(k)))throw Error('INVALID_BINDING_FIELDS');
  if (b.schema_version !== 1 || b.authorized !== true || !id(b.project_id) || !id(b.endpoint_id) || typeof b.model !== 'string' || !b.model.trim() || b.model.length > 128 || typeof b.allow_create_session !== 'boolean') throw Error('INVALID_BINDING');
  if (!path.isAbsolute(b.project_root) || fs.realpathSync(b.project_root) !== path.resolve(b.project_root)) throw Error('INVALID_PROJECT_ROOT');
  const root = b.project_root;
  checkedPath(path.resolve(file), root);
  for (const key of ['runtime_dir','workspace','config_dir']) {
    b[key] = checkedPath(b[key], root);
    if (b[key] === root) throw Error('ISOLATED_DIRECTORY_REQUIRED');
  }
  const directories=[b.runtime_dir,b.workspace,b.config_dir];
  if(directories.some((a,i)=>directories.some((c,j)=>i!==j&&inside(a,c))))throw Error('ISOLATED_DIRECTORY_REQUIRED');
  if(b.require_zero_credits!==undefined && typeof b.require_zero_credits!=='boolean')throw Error('INVALID_COST_POLICY');
  if(b.require_zero_credits===true && b.model!=='hy3')throw Error('ZERO_CREDITS_MODEL_NOT_APPROVED');
  if(b.run_timeout_ms!==undefined && (!Number.isInteger(b.run_timeout_ms)||b.run_timeout_ms<1000||b.run_timeout_ms>180000))throw Error('INVALID_RUN_BUDGET');
  if (!path.isAbsolute(b.cli_entry) || !fs.existsSync(b.cli_entry)) throw Error('MISSING_CLI');
  const expires = Date.parse(b.expires_at);
  if (!Number.isFinite(expires) || (!expiredOK && (expires <= Date.now() || expires - Date.now() > 600000))) throw Error('BINDING_EXPIRED_OR_UNBOUNDED');
  const {expires_at, ...scope} = b;
  b.scope = crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return b;
}
function resource(b, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,180}$/.test(name)) throw Error('INVALID_RESOURCE_NAME');
  const file = checkedPath(path.join(b.runtime_dir, name), b.project_root);
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.statSync(file).nlink !== 1)) throw Error('UNSAFE_RESOURCE');
  return file;
}
export function readRecord(b, name) {
  const file = resource(b, name);
  if (!fs.existsSync(file)) return null;
  if(fs.statSync(file).size>524288)throw Error('RECORD_SIZE_LIMIT');
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('CORRUPT_RECORD');}
}
export function saveRecord(b, name, value, {exclusive = false} = {}) {
  fs.mkdirSync(b.runtime_dir, {recursive:true, mode:0o700});
  const dest = resource(b, name);
  const tmp = checkedPath(path.join(b.runtime_dir, `tmp-${crypto.randomUUID()}`), b.project_root);
  const reservation = checkedPath(dest+'.reservation', b.project_root);
  let reserved=false;
  try {
    if(exclusive){fs.mkdirSync(reservation);reserved=true;if(fs.existsSync(dest)){const error=new Error('Record already exists');error.code='EEXIST';throw error;}}
    fs.writeFileSync(tmp, JSON.stringify(value,null,2), {flag:'wx',mode:0o600});
    fs.renameSync(tmp,dest);
  }finally {
    if(fs.existsSync(tmp))fs.unlinkSync(tmp);
    if(reserved)fs.rmdirSync(reservation);
  }
}
export function claimHost(b) {
  fs.mkdirSync(b.runtime_dir, {recursive:true,mode:0o700});
  const dir = checkedPath(path.join(b.runtime_dir,'host.lock'), b.project_root);
  try { fs.mkdirSync(dir); } catch { throw Error('BUSY_UNCERTAIN'); }
  const nonce = crypto.randomUUID();
  fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});
  return () => {
    checkedPath(dir,b.project_root);
    const owner=JSON.parse(fs.readFileSync(path.join(dir,'owner.json'),'utf8'));
    if(owner.nonce!==nonce)throw Error('BUSY_UNCERTAIN');
    fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);
  };
}
export function verifyRequest(b,s) {
  if(s.schema_version!==1 || s.adapter_id!==ADAPTER || s.project_id!==b.project_id || s.project_root!==b.project_root || s.endpoint_id!==b.endpoint_id || !id(s.request_id) || typeof s.request_token!=='string' || s.request_token.length<16 || typeof s.message!=='string' || s.message.length>100000)throw Error('REQUEST_SCOPE_MISMATCH');
  checkedPath(s.request_file,b.project_root);checkedPath(s.reply_file,b.project_root);
  return s;
}
export function identityRecord(b,s,extra={}) {
  return {schema_version:1,scope:b.scope,project_id:s.project_id,request_id:s.request_id,endpoint_id:s.endpoint_id,request_token:s.request_token,...extra};
}
export function verifyRecord(b,s,v) {
  if(!v || v.schema_version!==1 || v.scope!==b.scope || ['project_id','request_id','endpoint_id','request_token'].some(k=>v[k]!==s[k]))throw Error('RECORD_IDENTITY_MISMATCH');
  return v;
}
export async function parseSSE(response, onEvent, maxFrame=131072) {
  if(!response.ok)throw Error(`SSE_HTTP_${response.status}`);
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('SSE_CONTENT_TYPE');
  let buffer='';const decoder=new TextDecoder();
  for await(const chunk of response.body){
    buffer+=decoder.decode(chunk,{stream:true});
    let boundary;
    // Normalize after combining chunks, including CR/LF split across reads.
    buffer=buffer.replace(/\r\n/g,'\n');
    while((boundary=buffer.indexOf('\n\n'))>=0){
      if(boundary>maxFrame)throw Error('SSE_FRAME_LIMIT');
      const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
      const data=frame.split('\n').filter(v=>v.startsWith('data:')).map(v=>v.slice(5).trimStart()).join('\n');
      if(data){let event;try{event=JSON.parse(data);}catch{throw Error('SSE_INVALID_JSON');}if(await onEvent(event)===false)return;}
    }
    if(buffer.length>maxFrame)throw Error('SSE_FRAME_LIMIT');
  }
  if(buffer.trim())throw Error('SSE_INCOMPLETE_FRAME');
}
export class ResidentClient {
  constructor(origin,password,{fetchImpl=fetch,timeout=45000}={}) {
    const u=new URL(origin);
    if(u.protocol!=='http:' || u.hostname!=='127.0.0.1' || !u.port || u.username || u.password || u.search || u.hash || u.pathname!=='/')throw Error('UNTRUSTED_ORIGIN');
    this.origin=u.origin;this.password=password;this.fetch=fetchImpl;this.timeout=timeout;this.rpcId=0;
  }
  async response(route,body,headers={}) {
    if(typeof route!=='string' || !route.startsWith('/api/') || route.includes('..') || route.includes('?'))throw Error('INVALID_ROUTE');
    return this.fetch(this.origin+route,{method:body?'POST':'GET',headers:{'x-codebuddy-request':'1','authorization':'Bearer '+this.password,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout)});
  }
  async json(route,body,headers) {
    const response=await this.response(route,body,headers);
    if(!response.ok)throw Error(`NATIVE_HTTP_${response.status}`);
    let v;try{v=await response.json();}catch{throw Error('NATIVE_INVALID_JSON');}if(v.error)throw Error('NATIVE_RPC_ERROR');return v.data??v;
  }
  async rpc(method,params) {
    const requestId=++this.rpcId;
    const response=await this.response('/api/v1/acp',{jsonrpc:'2.0',id:requestId,method,params},{accept:'application/json, text/event-stream',...this.headers});
    let result;
    const consume=v=>{if(v.method==='session/request_permission')throw Error('NEED_USER');if(v.id===requestId){if(v.error)throw Error('ACP_RPC_ERROR');if(Object.hasOwn(v,'result')){result=v.result;return false;}}};
    if(response.headers.get('content-type')?.includes('text/event-stream'))await parseSSE(response,consume);
    else {if(!response.ok)throw Error(`ACP_HTTP_${response.status}`);let value;try{value=await response.json();}catch{throw Error('ACP_INVALID_JSON');}consume(value);}
    if(result===undefined)throw Error('ACP_NO_MATCHING_RESULT');return result;
  }
  async verifyZeroCredits(b) {
    const result=await this.rpc('session/load',{sessionId:this.nativeId,cwd:b.workspace,mcpServers:[]});
    const live=await this.json('/api/v1/sessions/live');
    if((result.sessionId!==undefined&&result.sessionId!==this.nativeId)||live.sessionId!==this.nativeId)throw Error('PRICING_NATIVE_ID_MISMATCH');
    if(result.models?.currentModelId!==b.model||b.model!=='hy3')throw Error('PRICING_MODEL_MISMATCH');
    const choices=(result.models?.availableModels??[]).filter(v=>v.modelId===b.model);
    if(choices.length!==1||choices[0]._meta?.credits!=='x0.00')throw Error('ZERO_CREDITS_UNVERIFIED');
    if((result.configOptions??[]).some(v=>v.category==='model'&&v.currentValue!==b.model))throw Error('PRICING_MODEL_MISMATCH');
    return {model:b.model,credits:'x0.00',observed_at:new Date().toISOString()};
  }
  async attach(b) {
    const connect=await this.json('/api/v1/acp/connect',{});
    if(typeof connect.connectionId!=='string')throw Error('ACP_NO_CONNECTION');
    this.headers={'acp-connection-id':connect.connectionId,...connect.sessionToken?{'acp-session-token':connect.sessionToken}:{}};
    await this.rpc('initialize',{protocolVersion:1,clientInfo:{name:ADAPTER,version:'1'},clientCapabilities:{}});
    const saved=readRecord(b,'native-session.json');
    if(saved&&saved.scope!==b.scope)throw Error('NATIVE_SCOPE_CHANGED');
    if(saved&&!id(saved.native_id))throw Error('INVALID_NATIVE_ID');
    const result=await this.rpc(saved?'session/load':'session/new',saved?{sessionId:saved.native_id,cwd:b.workspace,mcpServers:[]}:(b.allow_create_session?{cwd:b.workspace,mcpServers:[]}: (()=>{throw Error('CREATE_NOT_AUTHORIZED');})()));
    const live=await this.json('/api/v1/sessions/live');
    const native=result.sessionId??live.sessionId;
    if(!id(native) || live.sessionId!==native || saved&&saved.native_id!==native)throw Error('NATIVE_ID_CHANGED');
    this.nativeId=native;
    const model=result.models?.currentModelId;
    if(!saved)saveRecord(b,'native-session.json',{schema_version:1,scope:b.scope,native_id:native,observed_model:typeof model==='string'?model:null});
    if(typeof model!=='string')throw Error('NATIVE_MODEL_UNVERIFIED');
    if(model!==b.model || (result.configOptions??[]).some(v=>v.category==='model'&&v.currentValue!==model))throw Error('NATIVE_MODEL_MISMATCH');
    this.model=model;
    return native;
  }
}
export function extractFinal(text,state) {
  if(typeof text!=='string')throw Error('EMPTY_FINAL');
  const matches=[...text.matchAll(/<ai-chat-response>\s*(\{[\s\S]*?\})\s*<\/ai-chat-response>/g)];
  if(matches.length!==1)throw Error('FINAL_PROTOCOL_ERROR');
  let value;try{value=JSON.parse(matches[0][1]);}catch{throw Error('FINAL_INVALID_JSON');}return validateFinal(value,state);
}
function failureCode(text) {
  if(/^AuthenticationRequiredError:/.test(text??''))return 'LOGIN_REQUIRED';
  if(/^Error: 429 usage exceeds frequency limit/.test(text??''))return 'RATE_LIMITED';
  return 'FINAL_PROTOCOL_ERROR';
}
export async function collectRun(b,s,client,runId) {
  const stream=await client.response('/api/v1/runs/'+encodeURIComponent(runId)+'/stream');
  let final=false;
  await parseSSE(stream,v=>{
    if(v.replyTo!==s.request_id || !['completed','error'].includes(v.status))return;
    if(final)throw Error('MULTIPLE_NATIVE_FINALS');
    if(v.status==='completed' && (v.agent?.sessionId!==client.nativeId || v.agent?.toolCalls?.length!==0))throw Error('NATIVE_ID_OR_TOOLS_MISMATCH');
    final=true;
    const record=identityRecord(b,s,{native_id:client.nativeId,run_id:runId,native_final:true});
    if(v.status==='error') {
      const message=String(v.error?.message??'');
      const native_error_code=typeof v.error?.code==='string'&&/^[A-Za-z0-9_:-]{1,80}$/.test(v.error.code)?v.error.code:null;
      saveRecord(b,s.request_id+'.observation.json',{...record,native_final:false,uncertain:true,code:'NATIVE_EXECUTION_OUTCOME_UNKNOWN',native_error_code,error_message_sha256:crypto.createHash('sha256').update(message).digest('hex')});
      throw Error('NATIVE_EXECUTION_OUTCOME_UNKNOWN');
    }
    const text=v.content?.markdown??v.content?.text;
    try {saveRecord(b,s.request_id+'.reply.json',{...record,response:extractFinal(text,s)});}
    catch(error){if(error.code)throw error;saveRecord(b,s.request_id+'.failure.json',{...record,code:failureCode(text)});}
    return false;
  });
  if(!final)throw Error('NO_MATCHING_NATIVE_FINAL');
}
export async function processDispatch(b,s,message,client) {
  verifyRequest(b,s);
  if(typeof message!=='string'||message.length>120000)throw Error('INVALID_MESSAGE');
  const old=readRecord(b,s.request_id+'.claim.json');
  if(old){
    verifyRecord(b,s,old);
    if(readRecord(b,s.request_id+'.reply.json') || readRecord(b,s.request_id+'.failure.json'))return 'ALREADY_COLLECTED';
    const receipt=readRecord(b,s.request_id+'.receipt.json');
    if(receipt){verifyRecord(b,s,receipt);if(receipt.native_id===client.nativeId){await collectRun(b,s,client,receipt.run_id);return 'RECOVERED';}}
    return 'CLAIM_ALREADY_EXISTS';
  }
  // Host-level ownership check also protects queues submitted without Relay.
  for(const name of fs.readdirSync(b.runtime_dir).filter(n=>n.endsWith('.claim.json'))) {
    const claim=readRecord(b,name);
    if(!id(claim?.request_id)||name!==claim.request_id+'.claim.json')throw Error('INVALID_PENDING_CLAIM');
    verifyRecord(b,claim,claim);
    if(claim.project_id!==b.project_id||claim.endpoint_id!==b.endpoint_id)throw Error('PENDING_CLAIM_SCOPE_MISMATCH');
    const reply=readRecord(b,claim.request_id+'.reply.json');
    const failure=readRecord(b,claim.request_id+'.failure.json');
    if(reply){verifyRecord(b,claim,reply);validateFinal(reply.response,claim);continue;}
    if(failure){verifyRecord(b,claim,failure);if(failure.code!=='NATIVE_EXECUTION_ERROR'&&(failure.native_final===true||failure.verified_no_delivery===true))continue;}
    throw Error('OTHER_REQUEST_OUTCOME_UNKNOWN');
  }
  if(b.require_zero_credits===true) {
    if(typeof client.verifyZeroCredits!=='function')throw Error('ZERO_CREDITS_CHECK_UNAVAILABLE');
    const price=await client.verifyZeroCredits(b);
    if(price?.model!==b.model||price.credits!=='x0.00')throw Error('ZERO_CREDITS_UNVERIFIED');
    saveRecord(b,s.request_id+'.pricing.json',identityRecord(b,s,{...price,native_id:client.nativeId,actual_deduction:'UNKNOWN'}));
  }
  if(Date.parse(b.expires_at)-Date.now()<=1000)throw Error('INSUFFICIENT_RUN_BUDGET');
  saveRecord(b,s.request_id+'.claim.json',identityRecord(b,s,{phase:'BEFORE_POST',native_id:client.nativeId}),{exclusive:true});
  const response=await client.response('/api/v1/runs',{version:'1.0',id:s.request_id,type:'message',source:{platform:'generic',sender:{id:ADAPTER},conversation:{id:b.endpoint_id,type:'direct'}},payload:{text:message},timeoutMs:Math.max(1000,Math.min(b.run_timeout_ms??120000,Date.parse(b.expires_at)-Date.now()-1000))});
  if(response.status!==202){
    if([400,401,403,429].includes(response.status))saveRecord(b,s.request_id+'.failure.json',identityRecord(b,s,{code:`HTTP_REJECTED_${response.status}`,verified_no_delivery:true}));
    throw Error(`RUN_POST_HTTP_${response.status}`);
  }
  let created;try{created=await response.json();}catch{throw Error('RUN_RECEIPT_INVALID_JSON');}const runId=(created.data??created).runId;
  if(!id(runId))throw Error('INVALID_RUN_RECEIPT');
  const receipt=identityRecord(b,s,{run_id:runId,native_id:client.nativeId,delivered:true});
  saveRecord(b,s.request_id+'.receipt.json',receipt);
  await collectRun(b,s,client,runId);
  return 'COLLECTED';
}
export async function launchBackend(b,{signal}={}) {
  if(['CODEBUDDY_API_KEY','CODEBUDDY_AUTH_TOKEN','CODEBUDDY_BASE_URL'].some(k=>process.env[k]))throw Error('EXTERNAL_PROVIDER_OVERRIDE_NOT_AUTHORIZED');
  fs.mkdirSync(b.workspace,{recursive:true,mode:0o700});
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const password=crypto.randomBytes(32).toString('hex');
  const child=spawn(process.execPath,[b.cli_entry,'--serve','--host','127.0.0.1','--port',String(port),'--auth','password','--model',b.model,'--tools','','--permission-mode','plan','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'],{cwd:b.workspace,env:{...process.env,CODEBUDDY_CONFIG_DIR:b.config_dir,CODEBUDDY_DISABLE_SHELL_SNAPSHOT:'1',CODEBUDDY_GATEWAY_AUTH:'password',CODEBUDDY_GATEWAY_PASSWORD:password,CODEBUDDY_FORCE_HEADLESS_BUNDLE:'1',CODEBUDDY_FORCE_LITE_WB_BUNDLE:'0',CODEBUDDY_DAEMON_AUTO_CONNECT_CHANNELS:'0',DISABLE_AUTOUPDATER:'1'},stdio:['ignore','pipe','pipe'],detached:true});
  // Drain privately: CLI output can include a gateway login URL/password.
  child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
  let exited=false;child.on('exit',()=>{exited=true;});const client=new ResidentClient(`http://127.0.0.1:${port}`,password,{timeout:Math.min(b.run_timeout_ms??120000,Math.max(1000,Date.parse(b.expires_at)-Date.now()))+15000});
  client.signal=signal;
  const close=async()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}for(let n=0;n<20&&!exited;n++)await new Promise(r=>setTimeout(r,100));if(!exited){try{process.kill(-child.pid,'SIGKILL');}catch{}for(let n=0;n<20&&!exited;n++)await new Promise(r=>setTimeout(r,100));}if(!exited)throw Error('BACKEND_CLOSE_UNCONFIRMED');};
  try {for(let n=0;n<30;n++){if(signal?.aborted)throw Error('BACKEND_START_ABORTED');if(exited)throw Error('BACKEND_EXITED');try{await client.json('/api/v1/health');return {client,close,pid:child.pid,get alive(){return !exited;}};}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('BACKEND_START_TIMEOUT');}
  catch(error){await close();throw error;}
}
export async function serve(b,{backendFactory=launchBackend,signal}={}) {
  const release=claimHost(b),boot=crypto.randomUUID();let backend,heartbeat,stopWatch;
  const controller=new AbortController();
  const stop=()=>controller.abort();if(signal?.aborted)stop();signal?.addEventListener('abort',stop,{once:true});
  const expiry=setTimeout(stop,Math.max(0,Date.parse(b.expires_at)-Date.now()));
  const processed=new Set();
  try {
    if(controller.signal.aborted || readRecord(b,'STOP.json'))return;
    stopWatch=setInterval(()=>{try{if(readRecord(b,'STOP.json') || backend?.alive===false)stop();}catch{stop();}},100);
    backend=await backendFactory(b,{signal:controller.signal});backend.client.signal=controller.signal;await backend.client.attach(b);
    const announce=()=>saveRecord(b,'ready.json',{schema_version:1,scope:b.scope,project_id:b.project_id,endpoint_id:b.endpoint_id,native_id:backend.client.nativeId,model_id:backend.client.model,host_pid:process.pid,boot_nonce:boot,updated_at:Date.now()});
    announce();heartbeat=setInterval(()=>{try{announce();}catch{controller.abort();}},2000);
    while(!controller.signal.aborted&&!readRecord(b,'STOP.json')){
      const queued=fs.readdirSync(b.runtime_dir).filter(n=>n.endsWith('.dispatch.json')).sort();
      for(const name of queued){
        if(controller.signal.aborted)break;
        if(processed.has(name))continue;
        processed.add(name);
        const dispatch=readRecord(b,name);if(dispatch.scope!==b.scope)throw Error('DISPATCH_SCOPE_MISMATCH');
        const s=verifyRequest(b,dispatch.state);
        if(name!==s.request_id+'.dispatch.json')throw Error('DISPATCH_NAME_MISMATCH');
        try {await processDispatch(b,s,dispatch.message,backend.client);}
        catch(error){const previous=readRecord(b,s.request_id+'.observation.json');if(previous)verifyRecord(b,s,previous);saveRecord(b,s.request_id+'.observation.json',identityRecord(b,s,{...previous,code:error.message,uncertain:true}));}
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }finally{
    clearTimeout(expiry);clearInterval(heartbeat);clearInterval(stopWatch);signal?.removeEventListener('abort',stop);
    if(backend)await backend.close();
    const ready=readRecord(b,'ready.json');if(ready?.boot_nonce===boot)saveRecord(b,'ready.json',{...ready,status:'STOPPED',updated_at:Date.now()});
    release();
  }
}
