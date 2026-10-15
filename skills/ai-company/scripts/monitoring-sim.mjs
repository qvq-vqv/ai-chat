import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import * as m from './monitoring-core.mjs';
export function run(args){
 if(args[0]!=='--offline'||!(args.length===1||(args.length===3&&args[1]==='--resume')))throw Error('USAGE: --offline [--resume TOOL_TEMP_ROOT]');
 const start=performance.now(),root=args.length===3?m.checkSandbox(args[2]):m.createSandbox(),release=m.lock(root);
 try{
 const s=fs.existsSync(path.join(root,'state.json'))?m.validateState(m.readJSON(root,'state.json')):m.initial();
 const event={schema_version:1,project_id:'fixture-project',task_id:'fixture-task',request_handle:null,event_id:`fixture-${s.seen.length}`,observed_at:0,source:'fixture',state:'SUSPECTED_INACTIVITY',evidence_refs:['fixture:quiet']};
 const i=m.observe(s,event),q=m.request(s,i,0);if(q.status==='PREPARING')q.status='SENDING';m.reconcile(q,'after_sending');
 const auth={project_id:i.project_id,endpoint_id:q.endpoint_id,reference:'fixture-auth',allow_recheck:true,max_queries:3,max_elapsed:60000};
 i.authorization_reference=auth.reference;
 const d={schema_version:1,project_id:i.project_id,task_id:i.task_id,incident_id:i.incident_id,request_id:q.request_id,endpoint_id:q.endpoint_id,request_token:q.request_token,decision_revision:i.decision_revision,evidence_revision:i.evidence_revision,facts:[],unknowns:[],hypotheses:[],action_type:'SAFE_STATUS_RECHECK',parameters:{request_id:q.request_id},contract_reference:null,verification_plan:['fixture-status']};
 const decision=m.diagnose(i,q,d,auth),action=m.actionResult(i,d,decision,0);
 const queries=[0,1000,2000,3000].map(t=>m.recheck(q,auth,t));const restarts=[1,2,3].map(()=>m.supervisor(s,'CRASH'));
 const notice=m.report(root,s,i,'UNKNOWN');m.writeJSON(root,'events.log',{events:[event],diagnosis:d,action,queries,restarts});
 const report={mode:'offline',external_calls:0,root,incident:i.incident_id,request_status:q.status,queries,restarts,delivery:notice.delivery,elapsed_ms:performance.now()-start,rss_snapshot_bytes:process.memoryUsage().rss,measurement:'single simulation process snapshot; not production resource budget',unverified:['live AI delivery','macOS sleep','native Supervisor restart','real notifications']};m.writeJSON(root,'report.json',report);return report;
 }finally{release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(run(process.argv.slice(2)),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
