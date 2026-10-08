import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Relay} from './relay-core.mjs';
export async function runCLI(moduleURL,createProvider) {
 if(!process.argv[1]||path.resolve(process.argv[1])!==fileURLToPath(moduleURL))return;
 try {
  const [command,...args]=process.argv.slice(2);const o={};
  for(let i=0;i<args.length;i++){
   if(args[i]==='--authorized')o.authorized=true;
   else if(args[i].startsWith('--') && args[i+1] && !args[i+1].startsWith('--'))o[args[i].slice(2)]=args[++i];
   else throw new Error('Invalid argument '+args[i]);
  }
  if(!command||command==='help'||command==='--help') {
   console.log('preflight --endpoint ID\nsend --project-root PATH --state-dir PATH --project ID --request-id ID --endpoint ID --message-file PATH --authorized\nstatus|wait --request PATH [--timeout-seconds 45]\nAntigravity: --cli PATH. WorkBuddy: official OAuth token in WORKBUDDY_ACCESS_TOKEN.');return;
  }
  const requireValue=k=>{if(!o[k])throw new Error('--'+k+' is required');return o[k];};
  const provider=createProvider(o),relay=new Relay(provider);let result;
  if(command==='preflight')result=await provider.preflight(requireValue('endpoint'));
  else if(command==='send')result=await relay.send({projectRoot:requireValue('project-root'),stateDir:requireValue('state-dir'),projectId:requireValue('project'),requestId:requireValue('request-id'),endpointId:requireValue('endpoint'),message:fs.readFileSync(requireValue('message-file'),'utf8'),authorized:!!o.authorized});
  else if(command==='wait'||command==='status') {
   const n=command==='status'?0:Number(o['timeout-seconds']??45);if(!Number.isFinite(n)||n<0||n>3600)throw new Error('timeout-seconds must be 0..3600');
   const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
   result=await relay.receive(requireValue('request'),{timeoutMs:n*1000,signal:controller.signal});
  }else throw new Error('Unknown command '+command);
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(JSON.stringify({status:'ERROR',error:error.message}));process.exitCode=1;}
}
