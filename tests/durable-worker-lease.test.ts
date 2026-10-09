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
 },{wait:async()=>{},fetcher:async(_input,init)=>{providerCalls++;assert(new Headers(init?.headers).get('X-Client-Request-Id')?.startsWith('durable-lease-'),'Missing recoverable provider identity');return new Response('{"status":"completed"}');}});
 try{const response=await lease.provider('https://provider.invalid');assert(response.ok&&providerCalls===1&&endCalls===3,'Provider replayed while acknowledging response');assert(JSON.stringify(requests[1])===JSON.stringify(requests[3]),'Acknowledgement identity changed');}finally{await lease.close();}
});
Deno.test('a lost completion response repeats the identical save and never changes success to an error',async()=>{
 let attempts=0;const bodies:unknown[]=[],result={p_result:{score:8},p_error:null};
 const lease=assessmentLease({lease_id:'lease'},async(_name,body)=>{bodies.push(body);if(++attempts<3)throw Error('lost save acknowledgement');return true;},{wait:async()=>{}});
 try{assert(await lease.finish('finish_resume_intake',result),'Save never recovered');assert(bodies.length===3&&bodies.every(x=>x===result),'Saved result changed during retry');}finally{await lease.close();}
 const down=assessmentLease({lease_id:'lease'},async()=>{throw Error('database down');},{wait:async()=>{}});
 try{let error;try{await down.finish('finish_resume_intake',result);}catch(e){error=e;}assert(error instanceof PersistencePending,'Persistence failure not held for recovery');}finally{await down.close();}
});
Deno.test('lost heartbeat cancels the running call and prevents another call',async()=>{
 let started!:()=>void;const running=new Promise<void>(r=>started=r);let calls=0;
 const lease=assessmentLease({lease_id:'lease'},async name=>name!=='heartbeat_assessment_work',{intervalMs:5,fetcher:async(_input,init)=>{
  calls++;started();return await new Promise<Response>((_resolve,reject)=>{const stop=()=>reject(Error('aborted'));if(init?.signal?.aborted)stop();else init?.signal?.addEventListener('abort',stop,{once:true});});
 }});
 try{const call=lease.provider('https://provider.invalid');await running;await call.catch(()=>{});await lease.provider('https://provider.invalid').catch(()=>{});assert(calls===1,'Lease loss allowed a second provider call');}finally{await lease.close();}
});

Deno.test('a forty-second database outage recovers the identical result without replaying the provider',async()=>{
 let clock=0,calls=0,saves=0;const delays:number[]=[],result={p_result:{score:8},p_error:null};
 const lease=assessmentLease({lease_id:'lease'},async(name,body)=>{
  if(name==='finish_resume_intake'){saves++;assert(body===result,'Result changed during outage');if(clock<40000)throw Error('database unavailable');}
  return true;
 },{now:()=>clock,wait:async ms=>{delays.push(ms);clock+=ms;},fetcher:async()=>{calls++;return new Response('{"status":"completed"}');}});
 try{await lease.provider('https://provider.invalid');assert(await lease.finish('finish_resume_intake',result),'Save failed after recovery');assert(calls===1&&saves===9&&clock===47000,'Outage replayed paid work or did not back off');assert(delays.every(d=>d>0&&d<=8000),'Retry delay is unbounded');}finally{await lease.close();}
});
Deno.test('a sustained database outage respects the elapsed retry budget and leaves work held',async()=>{
 let clock=0,saves=0;const lease=assessmentLease({lease_id:'lease'},async()=>{saves++;clock+=15000;throw Error('database unavailable');},{now:()=>clock,wait:async ms=>{clock+=ms;}});
 try{let failure;try{await lease.finish('finish_resume_intake',{p_result:{score:8}});}catch(e){failure=e;}
  assert(failure instanceof PersistencePending&&saves===4&&clock<=75000,'Outage was replayed or retries exceeded the time budget');
 }finally{await lease.close();}
});

Deno.test('one lost heartbeat response does not abort paid work; the next confirmation recovers',async()=>{
 let heartbeats=0,calls=0,release!:()=>void;
 const responseReady=new Promise<void>(r=>release=r);
 const lease=assessmentLease({lease_id:'lease'},async name=>{
  if(name==='heartbeat_assessment_work'){if(++heartbeats===1)throw Error('database temporarily unavailable');release();}
  return true;
 },{intervalMs:5,fetcher:async(_input,init)=>{
  calls++;await responseReady;assert(!init?.signal?.aborted,'One heartbeat failure aborted the provider');
  return new Response('{"status":"completed"}');
 }});
 try{await lease.provider('https://provider.invalid');assert(heartbeats>=2&&calls===1,'Recovery replayed paid work');}finally{await lease.close();}
});
Deno.test('unconfirmed heartbeats stop before the last confirmed lease can expire',async()=>{
 let clock=0,heartbeats=0,calls=0;
 const lease=assessmentLease({lease_id:'lease'},async name=>{
  if(name==='heartbeat_assessment_work'){heartbeats++;clock+=30000;throw Error('database unavailable');}
  return true;
 },{intervalMs:5,now:()=>clock,fetcher:async(_input,init)=>{
  calls++;return await new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
 }});
 try{await lease.provider('https://provider.invalid').catch(()=>{});assert(calls===1&&heartbeats===3&&clock===90000,'Heartbeat grace exceeded the lease safety window');}
 finally{await lease.close();}
});
