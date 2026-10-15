import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadBinding,serve} from './antigravity-sidecar.mjs';
function setup(t) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ai-chat-host-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const inbox=path.join(root,'inbox');fs.mkdirSync(inbox);
 const binding=path.join(root,'binding.json'),b={schema_version:1,authorized:true,project_root:root,project_id:'p',endpoint_id:'target',inbox,expires_at:new Date(Date.now()+10000).toISOString()};
 fs.writeFileSync(binding,JSON.stringify(b));return {root,inbox,binding,b};
}
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
test('host refuses unauthorized, expired and escaping binding',t=>{
 const {root,binding,b}=setup(t);
 for(const change of [{authorized:false},{expires_at:'2000-01-01'},{inbox:os.tmpdir()}]){write(binding,{...b,...change});assert.throws(()=>loadBinding(binding));}
});
test('native delivery uses only bound target; crashed claim is not resent',async t=>{
 const {root,inbox,binding}=setup(t);let deliveries=0;
 const state={project_id:'p',endpoint_id:'target',project_root:root,request_id:'ok',reply_file:path.join(root,'reply.json')};
 write(path.join(inbox,'ok.dispatch.json'),{state,message:'test'});
 write(path.join(inbox,'crash.dispatch.json'),{state:{...state,request_id:'crash'},message:'test'});fs.writeFileSync(path.join(inbox,'crash.dispatch.json.claimed'),'claimed');
 write(path.join(inbox,'wrong.dispatch.json'),{state:{...state,endpoint_id:'other',request_id:'wrong'},message:'test'});
 const provider={preflight:async()=>{},deliver:async()=>{deliveries++;fs.writeFileSync(path.join(inbox,'STOP'),'');}};
 await serve(binding,{provider,intervalMs:1});
 assert.equal(deliveries,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(inbox,'ok.receipt.json'))).status,'SENT');
 assert.equal(JSON.parse(fs.readFileSync(path.join(inbox,'crash.receipt.json'))).status,'SEND_UNKNOWN');
 assert.equal(JSON.parse(fs.readFileSync(path.join(inbox,'wrong.receipt.json'))).status,'REJECTED');
});
