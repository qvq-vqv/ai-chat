import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('installed directory symlink executes relay and router CLI instead of silently skipping',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-chat-link-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const scripts=path.dirname(fileURLToPath(import.meta.url)),link=path.join(root,'installed');fs.symlinkSync(path.dirname(scripts),link);
 const relay=execFileSync(process.execPath,[path.join(link,'scripts/workbuddy-session.mjs'),'help'],{encoding:'utf8'});assert.match(relay,/preflight --endpoint/);
 const router=execFileSync(process.execPath,[path.join(link,'scripts/adapter-router.mjs'),'list'],{encoding:'utf8'});assert.match(router,/workbuddy-session/);
});
