import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WorkBuddyFollowProvider} from './workbuddy-follow.mjs';
const target='11111111-1111-4111-8111-111111111111';
const cwd='/fixture';
const exe='/Applications/WorkBuddy AI.app/Contents/MacOS/Electron';
// Shares the hardened identity-verified discovery of workbuddy-session.
const probe={pidStatus:()=>'ALIVE',pidCwd:()=>cwd,pidExecutable:()=>exe,pidFingerprint:()=>({pid:123,ppid:1,pgid:123,uid:501,login:'fixture',command:'Electron'}),pidListenPorts:()=>[4444],pidStartTime:()=>1000,fileBirthtime:()=>null,verifyAppExecutable:()=>({ok:true,real:exe,app_root:'/Applications/WorkBuddy AI.app',bundle_id:'com.workbuddy.workbuddy-ai',declared_exe:'Electron'})};
function fixture(t,fetch,password='fixture-secret') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wb-follow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'sessions'));fs.mkdirSync(path.join(root,'projects','fixture'),{recursive:true});
 fs.writeFileSync(path.join(root,'sessions','123.json'),JSON.stringify({pid:123,kind:'interactive',sessionId:target,cwd,startedAt:1000000,endpoint:'http://127.0.0.1:4444'}));
 fs.writeFileSync(path.join(root,'projects','fixture',target+'.jsonl'),JSON.stringify({role:'assistant',status:'completed'})+'\n');
 return new WorkBuddyFollowProvider({'config-dir':root,fetch,password,'expected-cwd':cwd,probe});
}
test('append keeps desktop writer, checks exact live target and sends no auth to another origin',async t=>{
 const calls=[];const p=fixture(t,async(url,o)=>{calls.push({url,o});return Response.json({data:url.endsWith('/live')?{sessionId:target,writerOccupied:true}:{delivered:true}});});
 await p.preflight(target);const state={endpoint_id:target};await p.deliver(state,'hello');
 assert.equal(calls.filter(v=>v.o.method==='POST').length,1);assert.equal(calls.at(-1).url,'http://127.0.0.1:4444/api/v1/sessions/'+target+'/reply');
 assert.deepEqual(JSON.parse(calls.at(-1).o.body),{text:'hello'});assert.equal(calls.at(-1).o.redirect,'error');assert.equal(JSON.stringify(state).includes('fixture-secret'),false);
});
test('missing auth, rejected auth and target mismatch prevent all sends',async t=>{
 for(const mode of ['missing','401','foreign']) {
  let posts=0;const p=fixture(t,async(url,o)=>{if(o.method==='POST')posts++;return mode==='401'?new Response('',{status:401}):Response.json({data:{sessionId:'foreign'}});},mode==='missing'?'':'fixture-secret');
  await assert.rejects(p.preflight(target));assert.equal(posts,0);
 }
});
test('target switch between handshake and dispatch prevents append',async t=>{
 let reads=0,posts=0;const p=fixture(t,async(url,o)=>{if(o.method==='POST')posts++;return Response.json({data:{sessionId:++reads===1?target:'other'}});});
 await p.preflight(target);await assert.rejects(p.deliver({endpoint_id:target},'hello'),/TARGET_CHANGED/);assert.equal(posts,0);
});
