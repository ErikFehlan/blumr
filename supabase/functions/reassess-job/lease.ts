type RPC=(name:string,body:unknown)=>Promise<any>;
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export class PersistencePending extends Error {}

// Transport retries are confined to idempotent acknowledgements and saving the
// same result. Provider calls are never repeated after an ambiguous response.
export function assessmentLease(task:{lease_id:string},rpc:RPC,{fetcher=fetch,intervalMs=30000}:{fetcher?:Fetcher,intervalMs?:number}={}) {
 const controller=new AbortController();
 const deadline=setTimeout(()=>controller.abort(),300000);
 let heartbeat:Promise<void>|undefined,disposed=false;
 const timer=setInterval(()=>{
  if(heartbeat||disposed)return;
  heartbeat=rpc('heartbeat_assessment_work',{p_lease:task.lease_id})
   .then(ok=>{if(ok!==true)controller.abort();},()=>controller.abort())
   .finally(()=>{heartbeat=undefined;});
 },intervalMs);
 async function acknowledge(name:string,body:unknown) {
  let error:unknown;
  for(let n=0;n<3;n++)try{return await rpc(name,body);}catch(e){error=e;}
  throw error;
 }
 const provider:Fetcher=async(input,init={})=>{
  if(controller.signal.aborted)throw Error('worker_lease_lost');
  const call=crypto.randomUUID();
  // Never retry this RPC: a lost acknowledgement must not start paid work.
  const started=await rpc('begin_assessment_provider',{p_lease:task.lease_id,p_call:call});
  if(started!==true||controller.signal.aborted)throw Error('worker_lease_lost');
  const headers=new Headers(init.headers);
  headers.set('X-Client-Request-Id',`durable-${task.lease_id}-${call}`);
  const response=await fetcher(input,{...init,headers,signal:AbortSignal.any([controller.signal,...(init.signal?[init.signal]:[])])});
  // Read the entire body under the same timeout before acknowledging a terminal
  // response; receiving headers alone does not establish the provider outcome.
  const text=await response.text();
  let body;try{body=JSON.parse(text);}catch{throw Error('provider_outcome_uncertain');}
  if(response.status===408||response.status>=500||['queued','in_progress'].includes(body?.status))throw Error('provider_outcome_uncertain');
  if(await acknowledge('end_assessment_provider',{p_lease:task.lease_id,p_call:call})!==true)throw Error('worker_lease_lost');
  return new Response(text,{status:response.status,headers:response.headers});
 };
 return {provider,
  async finish(name:string,body:unknown) {
   try{return await acknowledge(name,body);}catch{throw new PersistencePending('result_persistence_pending');}
  },
  async close(){disposed=true;clearInterval(timer);clearTimeout(deadline);if(heartbeat)await heartbeat;}
 };
}
