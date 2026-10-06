import {assessmentLease,PersistencePending} from '../supabase/functions/reassess-job/lease.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
Deno.test({name:'1, 5 and 15 minute dependency interruptions preserve paid-call fencing',ignore:Deno.env.get('EXTENDED_OUTAGES')!=='1',fn:async()=>{
 const observations=await Promise.all([1,5,15].map(async minutes=>{
  const started=Date.now(),duration=minutes*60000,result={p_result:{score:8},p_error:null};
  let paidCalls=0,saves=0,accepted=0,ended=0,pending=false;
  const rpc=async(name:string,body:unknown)=>{
   if(name==='finish_resume_intake'){
    saves++;assert(body===result,'Retry changed the result');
    if(Date.now()-started<duration)throw Error('injected database transport interruption');
    accepted++;return true;
   }
   if(name==='heartbeat_assessment_work'&&Date.now()-started<duration)throw Error('injected heartbeat interruption');
   if(name==='end_assessment_provider')ended++;
   return true;
  };
  const lease=assessmentLease({lease_id:crypto.randomUUID()},rpc,{fetcher:async()=>{paidCalls++;return new Response('{"status":"completed"}');}});
  try{
   await lease.provider('https://provider.invalid');
   try{await lease.finish('finish_resume_intake',result);}catch(error){assert(error instanceof PersistencePending,'Save failure escaped without pending state');pending=true;}
   assert(pending&&paidCalls===1&&ended===1&&accepted===0,'Outage replayed work or acknowledged an unsaved result');
   const stoppedAt=Date.now()-started;assert(stoppedAt<80000,'Database retry budget was exceeded');
   while(Date.now()-started<duration)await wait(Math.min(30000,duration-(Date.now()-started)));
   await lease.provider('https://provider.invalid').then(()=>{throw Error('Lost lease restarted paid work');},()=>{});
   assert(paidCalls===1,'Expired lease sent another provider call');
   // A surviving owner still holding the exact result may retry persistence.
   // Process termination is different: this test does not claim its RAM survives.
   assert(await lease.finish('finish_resume_intake',result),'Identical result could not be saved after transport recovery');
   assert(paidCalls===1&&accepted===1,'Recovery duplicated billing or result acceptance');
   return {outage_minutes:minutes,elapsed_ms:Date.now()-started,paid_calls:paidCalls,save_attempts:saves,accepted_results:accepted,pending_observed:pending,scope:'Real elapsed dependency transport harness; real lease implementation; simulated RPC and provider; surviving process'};
  }finally{await lease.close();}
 }));
 await Deno.mkdir('test-results/outages',{recursive:true});
 await Deno.writeTextFile('test-results/outages/results.json',JSON.stringify({passed:true,observations},null,2));
}});
