import {runCLI} from './relay-cli.mjs';
export class WorkBuddyProvider {
 id='workbuddy-localassistant';
 // This API has one local-assistant channel, not arbitrary desktop conversation IDs.
 lockIdentity='authorized-local-assistant';
 constructor({fetchImpl=fetch,token=()=>process.env.WORKBUDDY_ACCESS_TOKEN}={}){this.fetch=fetchImpl;this.token=token;}
 async call(route,{method='GET',body}={}) {
  const token=this.token();if(!token)throw new Error('MISSING_AUTH: configure official OAuth WORKBUDDY_ACCESS_TOKEN; desktop login is not this authorization');
  const r=await this.fetch('https://www.workbuddy.cn/openapi/v2/'+route,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw new Error('WorkBuddy HTTP '+r.status+'; inspect authorization or service availability');
  const data=await r.json();if(data.code!==0)throw new Error('WorkBuddy API rejected request; code='+String(data.code));
  return data.data;
 }
 async preflight(endpoint) {
  if(endpoint!=='local-assistant')throw new Error('WorkBuddy OpenAPI targets local-assistant only; arbitrary desktop conversation IDs are unsupported');
  const value=await this.call('localassistant');if(value?.online!==true)throw new Error('WorkBuddy local assistant is offline');
  return {status:'PREFLIGHT_OK',endpoint_id:endpoint,receive_mode:'official message history plus explicit final envelope',dedicated_project_required:true};
 }
 async deliver(state,message) {
  const r=await this.call('localassistant/message',{method:'POST',body:{content:message,msg_type:'text'}});
  if(typeof r?.message_id!=='string'||!r.message_id)throw new Error('Missing WorkBuddy message receipt');
  return {message_id:r.message_id};
 }
 async poll(state) {
  if(!state.receipt?.message_id)return null; // Unknown sends are never resent automatically.
  const r=await this.call('localassistant/message?message_id='+encodeURIComponent(state.receipt.message_id));
  if(!Array.isArray(r?.messages))throw new Error('Unexpected WorkBuddy history shape');
  let pending=false;
  for(const m of r.messages) {
   if(m.role!=='assistant')continue;
   if(m.msg_type!=='text'){if(/permission|question/.test(m.msg_type||''))pending=true;continue;}
   const text=(Array.isArray(m.content)?m.content:[]).filter(x=>typeof x==='string').join('\n');
   const matches=[...text.matchAll(/<ai-chat-response>\s*([\s\S]*?)\s*<\/ai-chat-response>/g)];
   for(const match of matches){let value;try{value=JSON.parse(match[1]);}catch{continue;}
    if(value.request_id!==state.request_id || value.project_id!==state.project_id || value.request_token!==state.request_token)continue;
    if(matches.length!==1)throw new Error('Ambiguous final envelopes in WorkBuddy message');
    return value;
   }
  }
  return pending?{pending_permission:true}:null;
 }
}
await runCLI(import.meta.url,options=>new WorkBuddyProvider(options));
