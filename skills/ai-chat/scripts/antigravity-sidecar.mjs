import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AntigravityProvider} from './antigravity-session.mjs';
import {runCLI} from './relay-cli.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
function save(file,value) {
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.renameSync(tmp,file);
}
function confined(file,root) {
 const actual=fs.existsSync(file)?fs.realpathSync(file):path.join(fs.realpathSync(path.dirname(file)),path.basename(file));
 const rel=path.relative(root,actual);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Path escapes sidecar project');
 return actual;
}
export function loadBinding(file) {
 const b=read(file);
 if(b.schema_version!==1||b.authorized!==true||!b.project_id||!b.endpoint_id||!Number.isFinite(Date.parse(b.expires_at)))throw new Error('Invalid or unauthorized sidecar binding');
 b.project_root=fs.realpathSync(b.project_root);
 b.inbox=confined(b.inbox,b.project_root);
 if(!fs.statSync(b.inbox).isDirectory())throw new Error('Inbox must exist');
 if(Date.parse(b.expires_at)<=Date.now())throw new Error('Sidecar binding expired');
 return b;
}
export async function serve(bindingFile,{provider=new AntigravityProvider(),intervalMs=1000}={}) {
 const b=loadBinding(bindingFile);
 await provider.preflight(b.endpoint_id);
 const ready=path.join(b.inbox,'ready.json');
 while(Date.now()<Date.parse(b.expires_at)&&!fs.existsSync(path.join(b.inbox,'STOP'))) {
  save(ready,{status:'READY',pid:process.pid,project_id:b.project_id,endpoint_id:b.endpoint_id,updated_at:new Date().toISOString(),expires_at:b.expires_at});
  for(const name of fs.readdirSync(b.inbox).filter(n=>/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\.dispatch\.json$/.test(n))) {
   const jobFile=confined(path.join(b.inbox,name),b.project_root);
   const ackFile=jobFile.replace(/\.dispatch\.json$/,'.receipt.json');
   if(fs.existsSync(ackFile))continue;
   const claim=jobFile+'.claimed';
   // A crash after claiming may have submitted the native message. Never retry it.
   if(fs.existsSync(claim)){save(ackFile,{status:'SEND_UNKNOWN',error:'Interrupted native delivery; inspect target before retrying'});continue;}
   const job=read(jobFile),s=job.state;
   if(s?.project_id!==b.project_id||s.endpoint_id!==b.endpoint_id||s.project_root!==b.project_root||name!==s.request_id+'.dispatch.json'||typeof job.message!=='string') {
    save(ackFile,{status:'REJECTED',error:'Dispatch does not match authorized binding'});continue;
   }
   confined(s.reply_file,b.project_root);
   try{fs.writeFileSync(claim,'claimed\n',{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')continue;throw e;}
   try {await provider.deliver(s,job.message);save(ackFile,{status:'SENT',endpoint_id:b.endpoint_id,request_id:s.request_id});}
   catch {save(ackFile,{status:'SEND_UNKNOWN',error:'Native delivery failed or is uncertain; no automatic retry'});}
  }
  await pause(intervalMs);
 }
 save(ready,{status:'STOPPED',project_id:b.project_id,endpoint_id:b.endpoint_id,updated_at:new Date().toISOString()});
}
export class SidecarProvider extends AntigravityProvider {
 constructor(options={}) {super(options);this.bindingFile=options['binding'];}
 async preflight(endpoint) {
  this.binding=loadBinding(this.bindingFile);
  const b=this.binding,r=read(path.join(b.inbox,'ready.json'));
  const age=Date.now()-Date.parse(r.updated_at);
  if(endpoint!==b.endpoint_id||r.endpoint_id!==endpoint||r.project_id!==b.project_id||r.status!=='READY'||!Number.isFinite(age)||age<0||age>15000)throw new Error('Sidecar is not ready for this exact target');
  return {status:'PREFLIGHT_OK',endpoint_id:endpoint,transport:'app-managed-sidecar',receive_mode:'cooperative reply file'};
 }
 async deliver(state,message) {
  const b=this.binding;
  if(state.project_id!==b.project_id||state.project_root!==b.project_root)throw new Error('Project does not match sidecar binding');
  const file=path.join(b.inbox,state.request_id+'.dispatch.json');
  if(fs.existsSync(file))throw new Error('Existing dispatch; inspect receipt instead of resending');
  save(file,{state,message});
  const receipt=file.replace(/\.dispatch\.json$/,'.receipt.json');
  const until=Date.now()+15000;
  do {
   if(fs.existsSync(receipt)){const r=read(receipt);if(r.status!=='SENT')throw new Error(r.error||r.status);return {...r,transport:'app-managed-sidecar'};}
   await pause(250);
  }while(Date.now()<until);
  throw new Error('Sidecar receipt timed out; do not resend');
 }
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='serve') {
 try{if(process.argv[3]!=='--binding'||!process.argv[4])throw new Error('serve --binding FILE required');await serve(process.argv[4]);}
 catch(e){console.error(JSON.stringify({status:'ERROR',error:e.message}));process.exitCode=1;}
}else await runCLI(import.meta.url,o=>new SidecarProvider(o));
