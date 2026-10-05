import {assessmentLease,PersistencePending} from '../supabase/functions/reassess-job/lease.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
Deno.test('an unacknowledged provider fence never sends a provider request',async()=>{
 for(const mode of ['denied','lost']){
  let calls=0;
  const lease=assessmentLease({lease_id:'lease'},async()=>{if(mode==='lost')throw Error('connection lost');return false;},{fetcher:async()=>{calls++;return new Response('{}');}});
  try{await lease.provider('https://provider.invalid').then(()=>{throw Error('Fence was ignored');},()=>{});assert(calls===0,'Paid work escaped the fence');}finally{await lease.close();}
 }
});
Deno.test('interrupted transport and ambiguous HTTP responses never acknowledge a terminal provider outcome',async()=>{
 for(const kind of ['network','timeout','server','body','pending']){
  const rpcs:string[]=[],lease=assessmentLease({lease_id:'lease'},async name=>{rpcs.push(name);return true;},{fetcher:async()=>{
   if(kind==='network')throw Error('network interrupted');
   if(kind==='body')return new Response(new ReadableStream({start(c){c.error(Error('body interrupted'));}}));
   return new Response(kind==='pending'?'{"status":"in_progress"}':'{}',{status:kind==='timeout'?504:kind==='server'?500:200});
  }});
  try{await lease.provider('https://provider.invalid').then(()=>{throw Error('Ambiguous response was accepted');},()=>{});assert(rpcs.join(',')==='begin_assessment_provider','Uncertain provider work was released');}finally{await lease.close();}
 }
});
Deno.test('complete terminal responses are read before settlement; lost acknowledgements retry only the database',async()=>{
 let providerCalls=0,endCalls=0;const requests:unknown[]=[];
 const lease=assessmentLease({lease_id:'lease'},async(name,body)=>{
  requests.push(body);if(name==='end_assessment_provider'&&++endCalls<3)throw Error('lost acknowledgement');return true;
 },{fetcher:async(_input,init)=>{providerCalls++;assert(new Headers(init?.headers).get('X-Client-Request-Id')?.startsWith('durable-lease-'),'Missing recoverable provider identity');return new Response('{"status":"completed"}');}});
 try{const response=await lease.provider('https://provider.invalid');assert(response.ok&&providerCalls===1&&endCalls===3,'Provider replayed while acknowledging response');assert(JSON.stringify(requests[1])===JSON.stringify(requests[3]),'Acknowledgement identity changed');}finally{await lease.close();}
});
Deno.test('a lost completion response repeats the identical save and never changes success to an error',async()=>{
 let attempts=0;const bodies:unknown[]=[],result={p_result:{score:8},p_error:null};
 const lease=assessmentLease({lease_id:'lease'},async(_name,body)=>{bodies.push(body);if(++attempts<3)throw Error('lost save acknowledgement');return true;});
 try{assert(await lease.finish('finish_resume_intake',result),'Save never recovered');assert(bodies.length===3&&bodies.every(x=>x===result),'Saved result changed during retry');}finally{await lease.close();}
 const down=assessmentLease({lease_id:'lease'},async()=>{throw Error('database down');});
 try{let error;try{await down.finish('finish_resume_intake',result);}catch(e){error=e;}assert(error instanceof PersistencePending,'Persistence failure not held for recovery');}finally{await down.close();}
});
Deno.test('lost heartbeat cancels the running call and prevents another call',async()=>{
 let started!:()=>void;const running=new Promise<void>(r=>started=r);let calls=0;
 const lease=assessmentLease({lease_id:'lease'},async name=>name!=='heartbeat_assessment_work',{intervalMs:5,fetcher:async(_input,init)=>{
  calls++;started();return await new Promise<Response>((_resolve,reject)=>{const stop=()=>reject(Error('aborted'));if(init?.signal?.aborted)stop();else init?.signal?.addEventListener('abort',stop,{once:true});});
 }});
 try{const call=lease.provider('https://provider.invalid');await running;await call.catch(()=>{});await lease.provider('https://provider.invalid').catch(()=>{});assert(calls===1,'Lease loss allowed a second provider call');}finally{await lease.close();}
});
