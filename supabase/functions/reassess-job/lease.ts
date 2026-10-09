type RPC=(name:string,body:unknown)=>Promise<any>;
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export class PersistencePending extends Error {}

// Transport retries are confined to idempotent acknowledgements and saving the
// same result. Provider calls are never repeated after an ambiguous response.
export function assessmentLease(task:{lease_id:string},rpc:RPC,{fetcher=fetch,intervalMs=30000,wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}:{fetcher?:Fetcher,intervalMs?:number,wait?:(ms:number)=>Promise<void>,now?:()=>number}={}) {
 const controller=new AbortController();
 const deadline=setTimeout(()=>controller.abort(),300000);
 let heartbeat:Promise<void>|undefined,disposed=false,lastConfirmedHeartbeat=now();
 const timer=setInterval(()=>{
  if(heartbeat||disposed)return;
  heartbeat=rpc('heartbeat_assessment_work',{p_lease:task.lease_id})
   .then(ok=>{if(ok!==true)controller.abort();else lastConfirmedHeartbeat=now();},()=>{
    // A brief database outage is not proof of lost ownership. Retain the
    // running provider call inside the last confirmed two-minute lease;
    // stop after 90 seconds without confirmation, with a safety margin.
    if(now()-lastConfirmedHeartbeat>=90000)controller.abort();
   })
   .finally(()=>{heartbeat=undefined;});
 },intervalMs);
 async function acknowledge(name:string,body:unknown) {
  let error:unknown;const started=now();
  // Only identical terminal acknowledgements/completions may retry. Provider
  // starts never do. Backoff gives a brief database outage time to recover.
  for(let n=0;n<9;n++){
   try{return await rpc(name,body);}catch(e){error=e;}
   if(n===8||now()-started>=60000)break;
   await wait(Math.min(1000*2**n,8000,Math.max(0,60000-(now()-started))));
  }
  throw error;
 }
 const provider:Fetcher=async(input,init={})=>{
  let phase='fence',status:number|undefined;
  try{
  if(controller.signal.aborted)throw Error('worker_lease_lost');
  const call=crypto.randomUUID();
  // Never retry this RPC: a lost acknowledgement must not start paid work.
  const started=await rpc('begin_assessment_provider',{p_lease:task.lease_id,p_call:call});
  if(started!==true||controller.signal.aborted)throw Error('worker_lease_lost');
  const headers=new Headers(init.headers);
  headers.set('X-Client-Request-Id',`durable-${task.lease_id}-${call}`);
  phase='transport';
  const response=await fetcher(input,{...init,headers,signal:AbortSignal.any([controller.signal,...(init.signal?[init.signal]:[])])});
  status=response.status;phase='body';
  // Read the entire body under the same timeout before acknowledging a terminal
  // response; receiving headers alone does not establish the provider outcome.
  const text=await response.text();
  let body;try{body=JSON.parse(text);}catch{throw Error('provider_outcome_uncertain');}
  if(response.status===408||response.status>=500||['queued','in_progress'].includes(body?.status))throw Error('provider_outcome_uncertain');
  phase='acknowledgement';
  if(await acknowledge('end_assessment_provider',{p_lease:task.lease_id,p_call:call})!==true)throw Error('worker_lease_lost');
  return new Response(text,{status:response.status,headers:response.headers});
  }catch(error){
   // Categories only: never log authorization headers, source text or output.
   const message=error instanceof Error?error.message:'';
   const category=/illegal invocation/i.test(message)?'illegal_invocation':/abort|signal/i.test(message)?'abort_or_signal':/fetch|network|connection/i.test(message)?'connection':/JSON/i.test(message)?'response_format':'unclassified';
   console.warn('Durable provider interruption',JSON.stringify({phase,status,category,error_type:error instanceof Error?error.name:'unknown'}));
   throw error;
  }
 };
 return {provider,
  async finish(name:string,body:unknown) {
   try{return await acknowledge(name,body);}catch{throw new PersistencePending('result_persistence_pending');}
  },
  async close(){disposed=true;clearInterval(timer);clearTimeout(deadline);if(heartbeat)await heartbeat;}
 };
}
