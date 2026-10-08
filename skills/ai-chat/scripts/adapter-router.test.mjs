import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadAdapters, planConnection} from './adapter-router.mjs';
const endpoint={app:'codex',mode:'existing-session',session_id:'confirmed-session',caller_capabilities:['local_command','local_files']};
test('installed builtin resolves to candidate, never live-ready',()=>assert.equal(planConnection(endpoint).status,'CANDIDATE'));
test('model name cannot select an unrelated software adapter',()=>assert.equal(planConnection({...endpoint,app:'grok'}).status,'UNSUPPORTED'));
test('no API fallback for existing software or reverse mode',()=>assert.equal(planConnection({...endpoint,mode:'api',model:'example',api_authorized:true}).status,'UNSUPPORTED'));
test('send-only and missing caller capabilities are rejected',()=>{
 assert.equal(planConnection({...endpoint,caller_capabilities:[]}).status,'UNSUPPORTED');
 const a=loadAdapters().find(a=>a.id==='codex-session'); assert.equal(planConnection(endpoint,[{...a,capabilities:{...a.capabilities,receive:false}}]).status,'UNSUPPORTED');
});
test('multiple eligible adapters require explicit choice',()=>{
 const a=loadAdapters().find(a=>a.id==='codex-session'); const b={...a,id:'second'};
 assert.equal(planConnection(endpoint,[a,b]).status,'NEED_USER');
 assert.equal(planConnection({...endpoint,adapter_id:'second'},[a,b]).adapter.id,'second');
});
test('fixed session identity must be provided',()=>assert.equal(planConnection({...endpoint,session_id:null}).status,'NEED_USER'));
test('registered skill resolves paths, rejects duplicate IDs and builtin impersonation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-router-'));
 try {
  fs.writeFileSync(path.join(dir,'SKILL.md'),'External fixture');
  const a={...loadAdapters().find(a=>a.id==='codex-session'),id:'fixture',implementation:'skill',skill:'SKILL.md',target_app:'example'};
  fs.writeFileSync(path.join(dir,'adapter.json'),JSON.stringify(a));
  const all=loadAdapters([dir]); assert.equal(planConnection({...endpoint,app:'example'},all).status,'CANDIDATE');
  fs.writeFileSync(path.join(dir,'adapter.json'),JSON.stringify({...a,id:'codex-session'}));
  assert.throws(()=>loadAdapters([dir]),/Duplicate/);
  fs.writeFileSync(path.join(dir,'adapter.json'),JSON.stringify({...a,implementation:'builtin'}));
  assert.throws(()=>loadAdapters([dir]),/cannot claim/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('API skill candidate requires explicit model and authorization',()=>{
 const a={...loadAdapters().find(a=>a.id==='codex-session'),implementation:'skill',mode:'api',target_app:'example-api'};
 const e={app:'example-api',mode:'api',caller_capabilities:endpoint.caller_capabilities};
 assert.equal(planConnection(e,[a]).status,'NEED_USER');
 assert.equal(planConnection({...e,model:'confirmed',api_authorized:true},[a]).status,'CANDIDATE');
});

test('software-specific routes preserve exact mode, target and cooperative receive consent',()=>{
 const caller_capabilities=['local_command','local_files','network','official_workbuddy_oauth','antigravity_authenticated_context'];
 const ag={app:'antigravity',mode:'existing-session',session_id:'12345678-1234-1234-1234-123456789abc',caller_capabilities};
 assert.equal(planConnection(ag).status,'NEED_USER');
 assert.equal(planConnection({...ag,receive_mode_confirmed:true}).adapter.id,'antigravity-session');
 const wb={app:'workbuddy',mode:'local-assistant',session_id:'local-assistant',caller_capabilities,receive_mode_confirmed:true};
 assert.equal(planConnection(wb).adapter.id,'workbuddy-localassistant');
 assert.equal(planConnection({...wb,session_id:'arbitrary-desktop-chat'}).status,'UNSUPPORTED');
 assert.equal(planConnection({...wb,mode:'existing-session'}).status,'UNSUPPORTED');
});
