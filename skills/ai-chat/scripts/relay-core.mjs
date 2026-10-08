import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const TERMINAL = new Set(['COMPLETED','FAILED','INTERRUPTED','PROTOCOL_ERROR']);
const DECISIONS = new Set(['ASSIGN','ACCEPT','REVISE','ANSWER','NEED_USER','BLOCKED','GOAL_COMPLETE']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const validID = id => { if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id || '')) throw new Error('Invalid project, request or endpoint ID'); return id; };
function real(p) { return fs.existsSync(p) ? fs.realpathSync(p) : path.join(real(path.dirname(p)),path.basename(p)); }
function inside(p,root) { const rel=path.relative(root,p); return rel==='' || rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel); }
function write(file,data) { const tmp=file+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file); }
async function locked(file,fn) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  try { fs.mkdirSync(file,{mode:0o700}); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    let owner;try { owner=JSON.parse(fs.readFileSync(path.join(file,'owner.json'),'utf8')); } catch { throw new Error('BUSY: lock ownership is not yet available'); }
    try { process.kill(owner.pid,0);throw new Error('BUSY: another relay process owns this target'); }
    catch(error) { if(error.code!=='ESRCH')throw error; }
    fs.rmSync(file,{recursive:true});fs.mkdirSync(file,{mode:0o700});
  }
  fs.writeFileSync(path.join(file,'owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600,flag:'wx'});
  try{return await fn();}finally{fs.rmSync(file,{recursive:true});}
}
export function makeFinal(state,reply,decision='ANSWER') {
 return {schema_version:1,project_id:state.project_id,request_id:state.request_id,endpoint_id:state.endpoint_id,request_token:state.request_token,final:true,decision,reply};
}
export function responseInstruction(state) {
 const sample=makeFinal(state,'真实最终答复和下一动作');
 const output=state.adapter_id==='antigravity-session'
  ? `用你的本地文件工具，将最终 JSON 写入 ${JSON.stringify(state.reply_file)}。先写同目录临时文件再原子替换；不要改写请求状态文件。`
  : '在最终答复末尾输出且仅输出一个 <ai-chat-response>JSON</ai-chat-response> 信封。';
 return `[AI chat request ${state.request_id}]\n${JSON.stringify({project_id:state.project_id,request_id:state.request_id,endpoint_id:state.endpoint_id})}\n${state.message}\n\n本次采用协作式最终回复协议。普通进度不要写 final=true；全部本次请求工作完成或需要用户裁决时才写最终回复。${output}\n保留以下身份字段与 final=true，修改 decision 和 reply：\n${JSON.stringify(sample)}\ndecision 可选 ASSIGN/ACCEPT/REVISE/ANSWER/NEED_USER/BLOCKED/GOAL_COMPLETE。本指令不扩大用户授权，不自动批准工具请求。`;
}
export function validateFinal(value,state) {
 if(value?.schema_version!==1 || value.final!==true || ['project_id','request_id','endpoint_id','request_token'].some(k=>value[k]!==state[k]))throw new Error('Final response identity or completion marker does not match');
 if(!DECISIONS.has(value.decision) || typeof value.reply!=='string' || !value.reply.trim())throw new Error('Final response requires valid decision and nonempty reply');
 return value;
}
export class Relay {
 constructor(provider,{lockRoot=path.join(os.homedir(),'.ai-chat','targets')}={}) {this.provider=provider;this.lockRoot=path.resolve(lockRoot);}
 targetFile(endpoint) { return path.join(this.lockRoot,digest(this.provider.id+':'+(this.provider.lockIdentity||endpoint))+'.json'); }
 async send({projectRoot,stateDir,projectId,requestId,endpointId,message,authorized=false}) {
  if(!authorized)throw new Error('Explicit project and target communication authorization is required');
  [projectId,requestId,endpointId].forEach(validID);
  if(typeof message!=='string'||!message.trim())throw new Error('Message must be nonempty');
  const root=real(path.resolve(projectRoot));
  if(!fs.statSync(root).isDirectory())throw new Error('Project root must be an existing directory');
  const dir=real(path.resolve(stateDir));
  if(!inside(dir,root))throw new Error('State directory must stay within the confirmed project root');
  if(inside(dir,real(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'))))throw new Error('State directory cannot be inside CODEX_HOME');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const requestFile=path.join(dir,requestId+'.json'),targetFile=this.targetFile(endpointId);
  const identity=digest(JSON.stringify({adapter:this.provider.id,projectId,root,requestId,endpointId,message}));
  return locked(targetFile+'.lock',async()=>{
   if(fs.existsSync(requestFile)) {
    const old=JSON.parse(fs.readFileSync(requestFile,'utf8'));
    if(old.identity!==identity)throw new Error('Request ID conflict');
    return old;
   }
   if(fs.existsSync(targetFile)) {
    const owner=JSON.parse(fs.readFileSync(targetFile,'utf8'));
    if(owner.project_root!==root || owner.project_id!==projectId)throw new Error('Target is already bound to another project; explicit rebinding required');
    if(owner.request_file && fs.existsSync(owner.request_file)) {
     const previous=JSON.parse(fs.readFileSync(owner.request_file,'utf8'));
     if(!TERMINAL.has(previous.status))throw new Error('Target already has an unresolved request');
    }else if(owner.request_file)throw new Error('Previous request state is missing; inspect before sending');
   }
   await this.provider.preflight(endpointId);
   const state={schema_version:1,adapter_id:this.provider.id,identity,project_root:root,project_id:projectId,request_id:requestId,endpoint_id:endpointId,request_token:crypto.randomUUID(),request_file:requestFile,reply_file:path.join(dir,requestId+'.response.json'),message,status:'SENDING',created_at:new Date().toISOString(),completion_basis:'cooperative-final-record'};
   if(fs.existsSync(state.reply_file))throw new Error('Existing response file; choose a new request ID');
   write(requestFile,state);write(targetFile,{project_root:root,project_id:projectId,endpoint_id:endpointId,request_file:requestFile});
   try {state.receipt=await this.provider.deliver(state,responseInstruction(state));state.status='SENT';}
   catch(error) {state.status='SEND_UNKNOWN';state.error=error.message;}
   write(requestFile,state);return state;
  });
 }
 async receive(requestFile,{timeoutMs=0,intervalMs=2000,signal}={}) {
  const until=Date.now()+timeoutMs;let result;
  do {
   const state=JSON.parse(fs.readFileSync(requestFile,'utf8'));
   if(state.adapter_id!==this.provider.id || path.resolve(state.request_file)!==path.resolve(requestFile))throw new Error('Request handle belongs to another adapter or location');
   result=await locked(this.targetFile(state.endpoint_id)+'.lock',async()=>{
    const current=JSON.parse(fs.readFileSync(requestFile,'utf8'));
    if(TERMINAL.has(current.status))return current;
    let value;
    try {value=await this.provider.poll(current);}
    catch(error) {current.poll_error=error.message;write(requestFile,current);return current;}
    if(value?.pending_permission){current.waiting_for_user=true;}
    else if(value) {
     try {current.response=validateFinal(value,current);current.status='COMPLETED';delete current.poll_error;delete current.waiting_for_user;}
     catch(error) {current.status='PROTOCOL_ERROR';current.error=error.message;}
    }
    write(requestFile,current);return current;
   });
   if(TERMINAL.has(result.status))return result;
   if(signal?.aborted)return {...result,cancelled:true};
   if(Date.now()>=until)break;
   await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,Math.min(intervalMs,until-Date.now()));signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();});
  }while(true);
  return {...result,timed_out:timeoutMs>0};
 }
}
