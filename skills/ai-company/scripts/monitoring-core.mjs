import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';

const text=v=>typeof v==='string'&&v.length>0&&v.length<=2048;
const list=v=>Array.isArray(v)&&v.length<=100&&v.every(text);
const records=v=>Array.isArray(v)&&v.length<=10000&&v.every(text);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const actions=['NO_ACTION_REQUIRED','SAFE_STATUS_RECHECK','DISPATCH_CONTRACT_TO_ROLE','REQUEST_USER_INTERVENTION'];
const states=['PREPARING','SENDING','SENT','SEND_UNKNOWN','COMPLETED','FAILED','INTERRUPTED','PROTOCOL_ERROR'];
export const pending=s=>['SENDING','SENT','SEND_UNKNOWN'].includes(s);
const schemas={
 MonitoringEvent:{schema_version:v=>v===1,project_id:text,task_id:text,request_handle:v=>v===null||text(v),event_id:text,observed_at:integer,source:text,state:text,evidence_refs:list},
 Incident:{schema_version:v=>v===1,project_id:text,task_id:text,incident_id:text,dedupe_key:text,state:v=>['OPEN','RESOLVED'].includes(v),evidence_revision:integer,decision_revision:integer,first_seen:integer,last_seen:integer,affected_resource:text,severity:v=>['LOW','HIGH'].includes(v),facts:list,hypotheses:list,resolution_criteria:obj,diagnosis_handle:v=>v===null||text(v),authorization_reference:v=>v===null||text(v)},
 Diagnosis:{schema_version:v=>v===1,project_id:text,task_id:text,incident_id:text,request_id:text,endpoint_id:text,request_token:text,decision_revision:integer,evidence_revision:integer,facts:list,unknowns:list,hypotheses:list,action_type:v=>actions.includes(v),parameters:obj,contract_reference:v=>v===null||text(v),verification_plan:list},
 ActionResult:{schema_version:v=>v===1,project_id:text,task_id:text,incident_id:text,action_id:text,decision_revision:integer,executor:text,policy_decision:v=>['ALLOWED','NEED_USER','DENIED'].includes(v),started_at:integer,finished_at:integer,evidence_refs:list,status:v=>['SUCCESS','FAILED','UNCERTAIN'].includes(v)}
};
export function validate(type,value){
 const shape=schemas[type]; if(!shape||!obj(value)||JSON.stringify(value).length>65536)throw Error('INVALID_SCHEMA');
 for(const [key,check] of Object.entries(shape))if(!check(value[key]))throw Error(`INVALID_SCHEMA:${key}`);
 if(type==='Diagnosis'&&Object.keys(value).some(k=>!Object.hasOwn(shape,k)))throw Error('INVALID_SCHEMA:unknown_field');
 return value;
}
// Only fresh tool-owned directories in the OS temporary directory are writable.
export function createSandbox(){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ai-company-offline-'));
 fs.writeFileSync(path.join(root,'.offline.json'),JSON.stringify({version:1,nonce:randomUUID()}),{flag:'wx',mode:0o600});return root;
}
export function checkSandbox(root){
 const absolute=path.resolve(root),base=fs.realpathSync(os.tmpdir());
 if(path.dirname(absolute)!==base||!path.basename(absolute).startsWith('ai-company-offline-'))throw Error('UNSAFE_ROOT');
 if(fs.lstatSync(absolute).isSymbolicLink()||fs.realpathSync(absolute)!==absolute)throw Error('UNSAFE_ROOT');
 const marker=path.join(absolute,'.offline.json');if(fs.lstatSync(marker).isSymbolicLink())throw Error('UNSAFE_ROOT');
 const m=JSON.parse(fs.readFileSync(marker,'utf8'));if(m.version!==1||!text(m.nonce))throw Error('UNSAFE_ROOT');return absolute;
}
function safeFile(root,name){root=checkSandbox(root);if(!/^[a-zA-Z0-9_.-]+$/.test(name)||name==='.offline.json'||name==='.'||name==='..')throw Error('UNSAFE_PATH');
 const file=path.join(root,name);if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.lstatSync(file).nlink!==1))throw Error('UNSAFE_PATH');return file;
}
export function writeJSON(root,name,value){const dest=safeFile(root,name),tmp=path.join(root,`.tmp-${randomUUID()}`);try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});fs.renameSync(tmp,dest);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
export function readJSON(root,name){const f=safeFile(root,name);try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){throw Error(`CORRUPTED_STATE:${e.code||'JSON'}`);}}
export function lock(root){root=checkSandbox(root);const dir=path.join(root,'monitor.lock');try{fs.mkdirSync(dir);}catch{throw Error('BUSY_UNCERTAIN');}const nonce=randomUUID();try{fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({nonce,pid:process.pid}),{flag:'wx'});}catch(e){throw Error(`BUSY_UNCERTAIN:${e.code}`);}return ()=>{if(fs.lstatSync(dir).isSymbolicLink())throw Error('BUSY_UNCERTAIN');const owner=JSON.parse(fs.readFileSync(path.join(dir,'owner.json'),'utf8'));if(owner.nonce!==nonce)throw Error('BUSY_UNCERTAIN');fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);};}
export const initial=()=>({version:1,incidents:{},requests:{},seen:[],frozen:[],crashes:0,episode:1,reports:[],clock:null,external_calls:0});
export function validateState(s){if(!obj(s)||s.version!==1||!obj(s.incidents)||!obj(s.requests)||!records(s.seen)||!records(s.frozen)||!integer(s.crashes)||!integer(s.episode)||!Array.isArray(s.reports)||s.external_calls!==0)throw Error('CORRUPTED_STATE');for(const i of Object.values(s.incidents))validate('Incident',i);for(const q of Object.values(s.requests))if(!states.includes(q.status)||!integer(q.deadline)||!integer(q.queries)||!integer(q.query_start)||!list(q.wait_intervals)||!['project_id','task_id','request_id','endpoint_id','request_token'].every(k=>text(q[k])))throw Error('CORRUPTED_STATE');return s;}
export function observe(s,event,criteria={kind:'TEST',test_id:'fixture-test',version:'v1'}){
 validate('MonitoringEvent',event);if(s.seen.includes(event.event_id))return 'DUPLICATE_EVENT';s.seen.push(event.event_id);
 if(event.state==='HEALTHY')return 'OBSERVED_ONLY';
 const key=`${event.project_id}/${event.task_id}`;let i=s.incidents[key];
 if(!i){i=s.incidents[key]={schema_version:1,project_id:event.project_id,task_id:event.task_id,incident_id:`incident-${event.event_id}`,dedupe_key:key,state:'OPEN',evidence_revision:0,decision_revision:1,first_seen:event.observed_at,last_seen:event.observed_at,affected_resource:event.task_id,severity:'LOW',facts:[],hypotheses:[],resolution_criteria:criteria,diagnosis_handle:null,authorization_reference:null,repairs:[],escalated:false};}
 if(i.state==='RESOLVED'){i.state='OPEN';i.decision_revision++;i.repairs=[];i.escalated=false;}
 i.evidence_revision++;i.last_seen=event.observed_at;i.facts.push(...event.evidence_refs);i.facts=i.facts.slice(-100);
 if(['SEVERITY_HIGH','MATERIAL_CHANGE','AUTH_REVOKED','IDENTITY_CHANGED'].includes(event.state)){i.decision_revision++;if(event.state==='SEVERITY_HIGH')i.severity='HIGH';if(event.state==='AUTH_REVOKED')i.authorization_reference=null;}
 if(!s.frozen.includes(key))s.frozen.push(key);return i;
}
export function request(s,i,now){const existing=s.requests[i.incident_id];if(existing&&(existing.status!=='COMPLETED'||existing.decision_revision===i.decision_revision))return existing; // FAILED is not replay authority either.
 const q={project_id:i.project_id,task_id:i.task_id,request_id:`diag-${i.incident_id}-${i.decision_revision}`,endpoint_id:'fixture-recovery',request_token:randomUUID(),status:'PREPARING',decision_revision:i.decision_revision,deadline:now+60000,queries:0,query_start:now,wait_intervals:[],waiting:null};s.requests[i.incident_id]=q;i.diagnosis_handle=q.request_id;return q;}
export function reconcile(q,window){if(!states.includes(q.status))throw Error('INVALID_STATE');if(['after_sending','before_receipt','before_persist'].includes(window)||q.status==='SENDING')q.status='SEND_UNKNOWN';return q;}
export function diagnose(i,q,d,auth){
 validate('Diagnosis',d);for(const k of ['project_id','task_id','request_id','endpoint_id','request_token'])if(d[k]!==q[k])return 'DENIED';
 if(!obj(d.parameters)||d.action_type==='SAFE_STATUS_RECHECK'&&!Object.hasOwn(d.parameters,'request_id'))return 'DENIED';
 if(d.incident_id!==i.incident_id||d.decision_revision!==i.decision_revision||d.decision_revision!==q.decision_revision||d.evidence_revision>i.evidence_revision||i.state!=='OPEN')return 'DENIED';
 if(!obj(auth)||auth.project_id!==i.project_id||auth.endpoint_id!==q.endpoint_id||!text(auth.reference)||auth.reference!==i.authorization_reference)return 'NEED_USER';
 if(!actions.includes(d.action_type))return 'DENIED';
 const keys=Object.keys(d.parameters);if(keys.some(k=>!['request_id','role','contract_id'].includes(k))||Object.values(d.parameters).some(v=>!text(v)))return 'DENIED';
 if(d.action_type==='SAFE_STATUS_RECHECK'&&(!auth.allow_recheck||d.parameters.request_id!==q.request_id))return 'NEED_USER';
 if(d.action_type==='DISPATCH_CONTRACT_TO_ROLE'&&(!auth.contracts?.includes(d.parameters.contract_id)||!auth.roles?.includes(d.parameters.role)||d.contract_reference!==d.parameters.contract_id||pending(q.status)))return 'NEED_USER';
 return d.action_type==='REQUEST_USER_INTERVENTION'?'NEED_USER':'ALLOWED';
}
export function recheck(q,auth,now,result={}){
 if(!auth?.allow_recheck||auth.project_id!==q.project_id||auth.endpoint_id!==q.endpoint_id)return 'NEED_USER';
 if(!text(auth.reference))return 'NEED_USER';
 const count=auth.max_queries??3,time=auth.max_elapsed??60000;if(!integer(count)||count>100||!integer(time)||time>3600000)throw Error('INVALID_BUDGET');
 if(q.queries>=count||now<q.query_start||now-q.query_start>=time)return 'BUDGET_EXHAUSTED';q.queries++;
 if(result.http===429)return result.body==='QUOTA_EXHAUSTED'?'QUOTA_EXHAUSTED':result.body==='RATE_LIMITED'?'RATE_LIMITED':'UNKNOWN_THROTTLE';return 'QUERY_ONLY';
}
export function wait(q,signal,now){if(signal?.trusted===true&&signal.request_id===q.request_id&&integer(signal.until)&&signal.until>now&&signal.until-now<=60000){q.waiting=signal.until;q.wait_intervals.push(`${now}:${signal.until}`);return 'WAITING_FOR_USER';}q.waiting=null;return 'RECHECK_WAIT_STATE';}
export function clock(s,wall,mono){if(!integer(wall)||!integer(mono))throw Error('INVALID_CLOCK');const old=s.clock;s.clock={wall,mono};if(old&&(wall<old.wall||mono<old.mono||wall-old.wall>30000||mono-old.mono>30000||Math.abs(wall-old.wall-(mono-old.mono))>5000))return 'OBSERVATION_GAP_UNKNOWN';return 'OBSERVED_ONLY';}
export function resolve(s,i,e){const c=i.resolution_criteria;if(e?.trusted!==true||e.project_id!==i.project_id||e.task_id!==i.task_id||e.kind!==c.kind||e.version!==c.version)return false;if(c.kind==='TEST'?(e.test_id!==c.test_id||e.exit_code!==0||e.assertions_passed!==true):e.signal!==c.signal)return false;i.state='RESOLVED';s.frozen=s.frozen.filter(k=>k!==i.dedupe_key);return true;}
export function repair(i,{hypothesis,change,verification,result,new_evidence}){if(i.state!=='OPEN'||i.escalated||i.repairs.length>=3)return 'ESCALATE';if(![hypothesis,change,verification].every(text)||!['FAILED','UNVERIFIED','SUCCESS'].includes(result))throw Error('INVALID_REPAIR');if(i.repairs.length&&!new_evidence){i.escalated=true;return 'ESCALATE';}i.repairs.push({hypothesis,change,verification,result});if(i.repairs.length>=3&&result!=='SUCCESS')i.escalated=true;return i.escalated?'ESCALATE':result;}
export function supervisor(s,event){if(event==='MANUAL_RESET'||event==='VERIFIED_HEALTH'){s.crashes=0;s.episode++;return 'RESET';}if(['NORMAL_EXIT','USER_STOP'].includes(event))return 'STOPPED';if(event!=='CRASH')throw Error('INVALID_EXIT');s.crashes++;return s.crashes>=3?'ESCALATE':'SIMULATED_RESTART';}
export function report(root,s,incident,delivery='UNKNOWN'){
 const allowed=['UNKNOWN','OFFLINE','FAILED','DELIVERED','REPLIED'];if(!allowed.includes(delivery))throw Error('INVALID_DELIVERY');
 const entry={incident_id:incident.incident_id,delivery:'NOT_ATTEMPTED',facts:incident.facts,repairs:incident.repairs,request:s.requests[incident.incident_id]??null,required_decision:'REVIEW',mode:'offline'};
 // Store only synthetic credentials; this module never opens a live binding.
 s.reports.push(entry);writeJSON(root,'state.json',s);fs.writeFileSync(safeFile(root,'INCIDENT.md'),`# Offline incident\n${JSON.stringify(entry,null,2)}\n`);entry.delivery=delivery;writeJSON(root,'state.json',s);return entry;
}

export function actionResult(i,d,decision,now){return validate('ActionResult',{schema_version:1,project_id:i.project_id,task_id:i.task_id,incident_id:i.incident_id,action_id:`action-${d.request_id}`,decision_revision:i.decision_revision,executor:'offline-policy',policy_decision:decision,started_at:now,finished_at:now,evidence_refs:i.facts,status:decision==='ALLOWED'?'SUCCESS':decision==='DENIED'?'FAILED':'UNCERTAIN'});}
