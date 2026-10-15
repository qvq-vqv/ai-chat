import {serve,loadBinding} from './resident-core.mjs';
try {
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='serve'||args[1]!=='--binding'||args[3]!=='--authorized')throw Error('Usage: serve --binding FILE --authorized');
  const binding=loadBinding(args[2]);
  const controller=new AbortController();
  process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  await serve(binding,{signal:controller.signal});
  console.log(JSON.stringify({status:'STOPPED',endpoint_id:binding.endpoint_id}));
}catch(error){console.error(JSON.stringify({status:'ERROR',code:error.code||'RESIDENT_ERROR',error:error.message}));process.exitCode=1;}
