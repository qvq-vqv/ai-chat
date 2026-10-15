import fs from 'node:fs';
import {WorkBuddySessionProvider,assertIdle} from './workbuddy-session.mjs';
import {runCLI} from './relay-cli.mjs';
// Use the native live-session append route, never ACP writer takeover.
export class WorkBuddyFollowProvider extends WorkBuddySessionProvider {
 id='workbuddy-session'; // Shares exact target lock and recovery with ACP.
 constructor(o={}) {super(o);this.password=o.password??process.env.AI_CHAT_WORKBUDDY_GATEWAY_PASSWORD;}
 async api(record,route,body) {
  if(!this.password)throw new Error('NEED_GATEWAY_AUTH: supply explicitly authorized local gateway password through AI_CHAT_WORKBUDDY_GATEWAY_PASSWORD');
  const r=await this.fetch(record.origin+route,{method:body?'POST':'GET',headers:{'x-codebuddy-request':'1','authorization':'Bearer '+this.password,...body?{'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},redirect:'error',signal:AbortSignal.timeout(body?180000:10000)});
  if(!r.ok)throw new Error('WorkBuddy follow endpoint rejected request: HTTP '+r.status);
  const v=await r.json();if(v.error)throw new Error('WorkBuddy follow endpoint returned an error');return v.data??v;
 }
 async live(record,endpoint) {
  const v=await this.api(record,'/api/v1/sessions/live');
  if(v.sessionId!==endpoint)throw new Error('TARGET_CHANGED: designated session is not live');
 }
 async preflight(endpoint) {
  const r=this.discover(endpoint);assertIdle(r,this.configDir,endpoint);
  await this.live(r,endpoint);this.record=r;
  return {status:'PREFLIGHT_OK',endpoint_id:endpoint,transport:'native-live-session-follow',receive_mode:'native completed assistant transcript plus exact final envelope; live worker required'};
 }
 async deliver(state,message) {
  const r=this.discover(state.endpoint_id);
  if(r.pid!==this.record.pid||r.origin!==this.record.origin)throw new Error('Target worker changed before send');
  state.native_transcript=assertIdle(r,this.configDir,state.endpoint_id);
  await this.live(r,state.endpoint_id);
  const v=await this.api(r,'/api/v1/sessions/'+encodeURIComponent(state.endpoint_id)+'/reply',{text:message});
  if(v.delivered!==true)throw new Error('Native append did not acknowledge delivery');
  return {transport:'native-live-session-follow',endpoint_id:state.endpoint_id,delivered:true};
 }
}
await runCLI(import.meta.url,o=>new WorkBuddyFollowProvider(o));
