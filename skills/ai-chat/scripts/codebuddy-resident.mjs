import fs from 'node:fs';
import {NativeTerminalError} from './relay-core.mjs';
import {runCLI} from './relay-cli.mjs';
import {ADAPTER,loadBinding,readRecord,saveRecord,verifyRecord,verifyRequest} from './resident-core.mjs';

export class CodeBuddyResidentProvider {
  id=ADAPTER;
  constructor(options={}) {
    if(!options.binding)throw Error('--binding is required');
    this.binding=loadBinding(options.binding,{expiredOK:true});
  }
  async preflight(endpoint) {
    const b=this.binding;
    if(endpoint!==b.endpoint_id || Date.parse(b.expires_at)<=Date.now())throw Error('BINDING_EXPIRED_OR_WRONG_TARGET');
    for(const name of fs.existsSync(b.runtime_dir)?fs.readdirSync(b.runtime_dir).filter(v=>v.endsWith('.failure.json')):[]){
      const legacy=readRecord(b,name);
      if(legacy?.scope===b.scope&&legacy.code==='NATIVE_EXECUTION_ERROR')throw Error('LEGACY_UNCERTAIN_FAILURE_NEEDS_REVIEW');
    }
    const ready=readRecord(b,'ready.json'),native=readRecord(b,'native-session.json');
    if(!ready || ready.status==='STOPPED' || ready.scope!==b.scope || ready.endpoint_id!==endpoint || ready.project_id!==b.project_id || ready.model_id!==b.model || ready.native_id!==native?.native_id || native.scope!==b.scope || !Number.isInteger(ready.host_pid) || Date.now()-ready.updated_at<0 || Date.now()-ready.updated_at>10000)throw Error('RESIDENT_NOT_READY');
    try{process.kill(ready.host_pid,0);}catch{throw Error('RESIDENT_HOST_NOT_ALIVE');}
    return {status:'PREFLIGHT_OK',endpoint_id:endpoint,native_id:ready.native_id,model:b.model,mode:'resumed-cli',billing:'current CLI login; subscription deduction not measured',receive_mode:'matched native completed SSE and persistent final envelope'};
  }
  async deliver(state,message) {
    const b=this.binding;verifyRequest(b,state);
    const name=state.request_id+'.dispatch.json';
    const old=readRecord(b,name);
    if(old){if(old.state.identity!==state.identity || old.message!==message)throw Error('DISPATCH_CONFLICT');}
    else saveRecord(b,name,{scope:b.scope,state,message},{exclusive:true});
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const receipt=readRecord(b,state.request_id+'.receipt.json');
      if(receipt)return verifyRecord(b,state,receipt);
      const failure=readRecord(b,state.request_id+'.failure.json');
      if(failure){verifyRecord(b,state,failure);throw Error('NATIVE_REJECTION_RECORDED');}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('QUEUE_ACK_UNKNOWN');
  }
  async poll(state) {
    const b=this.binding;verifyRequest(b,state);
    const reply=readRecord(b,state.request_id+'.reply.json');
    if(reply){verifyRecord(b,state,reply);return reply.response;}
    const failure=readRecord(b,state.request_id+'.failure.json');
    if(failure){verifyRecord(b,state,failure);if(failure.code==='NATIVE_EXECUTION_ERROR')throw Error('NATIVE_RESULT_UNKNOWN:LEGACY_UNCERTAIN_FAILURE');throw new NativeTerminalError(failure);}
    const observation=readRecord(b,state.request_id+'.observation.json');
    if(observation){verifyRecord(b,state,observation);throw Error('NATIVE_RESULT_UNKNOWN:'+observation.code);}
    return null;
  }
}
await runCLI(import.meta.url,options=>new CodeBuddyResidentProvider(options));
