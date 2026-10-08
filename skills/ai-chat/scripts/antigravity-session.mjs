import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runCLI} from './relay-cli.mjs';
const exec=promisify(execFile);
export class AntigravityProvider {
 id='antigravity-session';
 constructor({cli,execute=exec,contextAvailable=()=>!!(process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN)}={}) {
  const helper=path.join(os.homedir(),'.gemini/antigravity/bin/agentapi');
  this.cli=cli||(fs.existsSync(helper)?helper:'/Applications/Antigravity.app/Contents/Resources/bin/language_server');
  this.prefix=path.basename(this.cli)==='language_server'?['agentapi']:[];this.execute=execute;this.contextAvailable=contextAvailable;
 }
 async nativeCall(args,timeout) {
  try {
   const r=await this.execute(this.cli,[...this.prefix,...args],{shell:false,timeout,maxBuffer:1024*1024});
   if(String(r.stdout||'').trim().startsWith('{')) {
    try {const value=JSON.parse(r.stdout);if(value.error)throw new Error('Native RPC rejected request');}
    catch(error){if(!(error instanceof SyntaxError))throw error;}
   }
   return r;
  } catch {throw new Error('Antigravity native CLI request failed; verify app-provided authenticated context and target availability');}
 }
 async preflight(endpoint) {
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(endpoint||''))throw new Error('Antigravity requires an exact conversation UUID');
  if(!fs.existsSync(this.cli))throw new Error('Antigravity agentapi not found; provide --cli');
  if(!this.contextAvailable())throw new Error('MISSING_NATIVE_CONTEXT: app-provided ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN are required; do not scrape credentials or disable validation');
  await this.nativeCall(['get-conversation-metadata',endpoint],15000);
  return {status:'PREFLIGHT_OK',endpoint_id:endpoint,receive_mode:'cooperative reply file; verify target can write confirmed project'};
 }
 async deliver(state,message) {
  const r=await this.nativeCall(['send-message',state.endpoint_id,message],30000);
  return {cli_exit:0,stdout:String(r.stdout||'').slice(0,4000),note:'CLI returned; does not prove target started or finished'};
 }
 async poll(state) {
  if(!fs.existsSync(state.reply_file))return null;
  const root=fs.realpathSync(state.project_root),actual=fs.realpathSync(state.reply_file);
  const rel=path.relative(root,actual);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Reply file escapes the project');
  try{return JSON.parse(fs.readFileSync(state.reply_file,'utf8'));}catch(error){if(error instanceof SyntaxError)return null;throw error;}
 }
}
await runCLI(import.meta.url,options=>new AntigravityProvider(options));
