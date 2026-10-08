import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Relay,makeFinal} from './relay-core.mjs';
import {AntigravityProvider} from './antigravity-session.mjs';
import {WorkBuddyProvider} from './workbuddy-localassistant.mjs';
function fixture(t,provider) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-relay-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,relay:new Relay(provider,{lockRoot:path.join(root,'locks')}),args:{projectRoot:root,stateDir:path.join(root,'project-state'),projectId:'project',requestId:'request',endpointId:'local-assistant',message:'Read-only test',authorized:true}};
}
const basic=()=>({id:'fixture',preflight:async()=>{},deliver:async()=>({id:'receipt'}),poll:async()=>null});
test('repeat send is idempotent; unresolved target and ID conflicts do not redeliver',async t=>{
 let sends=0;const p={...basic(),deliver:async()=>{sends++;return {id:'r'};}};const f=fixture(t,p);
 await f.relay.send(f.args);await f.relay.send(f.args);assert.equal(sends,1);
 await assert.rejects(f.relay.send({...f.args,message:'Different'}),/conflict/);
 await assert.rejects(f.relay.send({...f.args,requestId:'next'}),/unresolved/);
});
test('uncertain send persists across restart without resend',async t=>{
 let sends=0;const p={...basic(),deliver:async()=>{sends++;throw Error('transport timeout');}};const f=fixture(t,p);
 const s=await f.relay.send(f.args);assert.equal(s.status,'SEND_UNKNOWN');
 const restarted=new Relay(p,{lockRoot:path.join(f.root,'locks')});
 assert.equal((await restarted.send(f.args)).status,'SEND_UNKNOWN');assert.equal(sends,1);
});
test('wait timeout and restart receive the matching cooperative final record',async t=>{
 let value=null;const f=fixture(t,{...basic(),poll:async()=>value});const s=await f.relay.send(f.args);
 const waiting=await f.relay.receive(s.request_file,{timeoutMs:10,intervalMs:5});assert.equal(waiting.timed_out,true);assert.equal(waiting.status,'SENT');
 value=makeFinal(s,'Task contract','ASSIGN');const r=await f.relay.receive(s.request_file);assert.equal(r.status,'COMPLETED');assert.equal(r.completion_basis,'cooperative-final-record');
});
test('mismatched or nonfinal response cannot unlock the next task',async t=>{
 let value=null;const f=fixture(t,{...basic(),poll:async()=>value});const s=await f.relay.send(f.args);
 value={...makeFinal(s,'Wrong'),request_token:'other'};assert.equal((await f.relay.receive(s.request_file)).status,'PROTOCOL_ERROR');
});
test('different projects cannot bind the same target, even after one completes',async t=>{
 let value=null;const f=fixture(t,{...basic(),poll:async()=>value});const s=await f.relay.send(f.args);value=makeFinal(s,'Done');await f.relay.receive(s.request_file);
 const other=path.join(f.root,'other');fs.mkdirSync(other);
 await assert.rejects(f.relay.send({...f.args,projectRoot:other,stateDir:path.join(other,'state'),projectId:'other'}),/another project/);
});
test('authorization and symlink escape are rejected before delivery',async t=>{
 const f=fixture(t,basic());await assert.rejects(f.relay.send({...f.args,authorized:false}),/authorization/);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'ai-relay-out-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(f.root,'escape'));
 await assert.rejects(f.relay.send({...f.args,stateDir:path.join(f.root,'escape','state')}),/within/);
});
test('Antigravity delivery preserves shell-sensitive content and reads only the requested final file',async t=>{
 const cli=path.join(os.tmpdir(),'ag-test-cli-'+process.pid);fs.writeFileSync(cli,'fixture');t.after(()=>fs.rmSync(cli,{force:true}));let calls=[];
 const p=new AntigravityProvider({cli,contextAvailable:()=>true,execute:async(command,args,options)=>{calls.push({command,args,options});return {stdout:'ok'};}});
 const absent=new AntigravityProvider({cli,contextAvailable:()=>false,execute:async()=>{throw Error('should not execute');}});
 await assert.rejects(absent.preflight('12345678-1234-1234-1234-123456789abc'),/MISSING_NATIVE_CONTEXT/);
 const f=fixture(t,p);f.args.endpointId='12345678-1234-1234-1234-123456789abc';f.args.message='literal `cmd` $(cmd) 中文';const s=await f.relay.send(f.args);
 assert.equal(calls.length,2);assert.equal(calls[1].options.shell,false);assert.ok(calls[1].args[2].includes(f.args.message));
 fs.writeFileSync(path.join(path.dirname(s.reply_file),'old.response.json'),JSON.stringify(makeFinal(s,'Old')));assert.equal((await f.relay.receive(s.request_file)).status,'SENT');
 fs.writeFileSync(s.reply_file,'{"unfinished":');assert.equal((await f.relay.receive(s.request_file)).status,'SENT');
 fs.writeFileSync(s.reply_file,JSON.stringify(makeFinal(s,'Final')));assert.equal((await f.relay.receive(s.request_file)).status,'COMPLETED');
});
test('WorkBuddy missing OAuth sends no HTTP and arbitrary desktop IDs are rejected',async()=>{
 let calls=0;const p=new WorkBuddyProvider({token:()=>null,fetchImpl:async()=>{calls++;}});
 await assert.rejects(p.preflight('local-assistant'),/MISSING_AUTH/);assert.equal(calls,0);
 await assert.rejects(p.preflight('some-desktop-chat'),/arbitrary/);
});
test('WorkBuddy history filters old, progress and foreign replies, then accepts the exact final envelope',async t=>{
 let frames=[];let requests=[];
 const p=new WorkBuddyProvider({token:()=>'fixture-secret',fetchImpl:async(url,options)=>{
  requests.push({url,options});const data=url.endsWith('/localassistant')?{online:true}:options.method==='POST'?{message_id:'receipt'}:{messages:frames};return {ok:true,json:async()=>({code:0,data})};
 }});const f=fixture(t,p);const s=await f.relay.send(f.args);
 const message=value=>({role:'assistant',msg_type:'text',content:['<ai-chat-response>'+JSON.stringify(value)+'</ai-chat-response>']});
 frames=[message({...makeFinal(s,'Foreign'),request_id:'foreign'}),{role:'assistant',msg_type:'text',content:['Still working']},message({...makeFinal(s,'old'),request_token:'old-token'})];
 assert.equal((await f.relay.receive(s.request_file)).status,'SENT');frames.push(message(makeFinal(s,'Final')));assert.equal((await f.relay.receive(s.request_file)).status,'COMPLETED');
 assert.ok(requests.at(-1).url.endsWith('?message_id=receipt'));assert.equal(requests[0].options.redirect,'error');assert.ok(!JSON.stringify(s).includes('fixture-secret'));
});
test('WorkBuddy tool approvals are surfaced without automatic approval',async t=>{
 let methods=[];const p=new WorkBuddyProvider({token:()=>'fixture',fetchImpl:async(url,o)=>{methods.push(o.method);const data=url.endsWith('/localassistant')?{online:true}:o.method==='POST'?{message_id:'r'}:{messages:[{role:'assistant',msg_type:'permission_request',content:[]}]};return {ok:true,json:async()=>({code:0,data})};}});
 const f=fixture(t,p);const s=await f.relay.send(f.args);assert.equal((await f.relay.receive(s.request_file)).waiting_for_user,true);assert.equal(methods.filter(m=>m==='POST').length,1);
});
test('concurrent delivery is refused and an abandoned process lock can be reclaimed',async t=>{
 let begin,release;const started=new Promise(r=>begin=r),gate=new Promise(r=>release=r);
 const f=fixture(t,{...basic(),deliver:async()=>{begin();await gate;return {id:'r'};}});
 const first=f.relay.send(f.args);await started;
 await assert.rejects(f.relay.send(f.args),/BUSY/);release();const state=await first;
 const lock=f.relay.targetFile(f.args.endpointId)+'.lock';fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:999999999}));
 assert.equal((await f.relay.receive(state.request_file)).status,'SENT');assert.equal(fs.existsSync(lock),false);
});
test('canceling a wait preserves the target and request for later receive',async t=>{
 let value=null;const f=fixture(t,{...basic(),poll:async()=>value});const s=await f.relay.send(f.args);
 const controller=new AbortController();controller.abort();const r=await f.relay.receive(s.request_file,{timeoutMs:1000,signal:controller.signal});
 assert.equal(r.cancelled,true);assert.equal(r.status,'SENT');value=makeFinal(s,'Recovered');assert.equal((await f.relay.receive(s.request_file)).status,'COMPLETED');
});
