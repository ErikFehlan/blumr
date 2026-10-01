// Server-computed semantic identity, scoped to an authenticated actor/workspace.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
type Claim = {state:'owner'|'processing'|'uncertain'|'complete',body?:unknown};
type Options = {
  workspace:string; actor:string; payload:unknown; base:string; serviceKey:string;
  execute:(requestId:string)=>Promise<Response>;
  wait?:(ms:number)=>Promise<void>; polls?:number;
};
const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
const failure=(code:string,message:string,status=503)=>new Response(JSON.stringify({code,error:message}),{status,headers});
export async function withDirectIdempotency(options:Options):Promise<Response> {
  const key=await fingerprint(options.payload),claim=crypto.randomUUID();
  const scope={p_workspace:options.workspace,p_actor:options.actor,p_fingerprint:key,p_claim:claim};
  const rpc=async(name:string,body:unknown)=>{
    const response=await fetch(options.base+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{Authorization:'Bearer '+options.serviceKey,apikey:options.serviceKey,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw Error('Request ledger unavailable');
    return await response.json();
  };
  try {
    const wait=options.wait||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
    for(let i=0;i<=(options.polls??40);i++){
      const result=await rpc('claim_direct_ai_request',scope) as Claim;
      if(result.state==='complete')return new Response(JSON.stringify(result.body),{status:200,headers});
      if(result.state==='uncertain')return failure('analysis_outcome_uncertain','The earlier analysis was interrupted. Its outcome needs verification before another run.');
      if(result.state==='owner'){
        // Ownership is durable before any admission, telemetry or provider work.
        const response=await options.execute(claim);
        const body=response.ok?await response.clone().json():null;
        if(await rpc('finish_direct_ai_request',{...scope,p_body:body})!==true)throw Error('Request ownership changed');
        return response;
      }
      if(result.state!=='processing')throw Error('Invalid request ledger response');
      if(i<(options.polls??40))await wait(2000);
    }
    return failure('analysis_in_progress','This analysis is already running. Wait briefly, then try again.',409);
  }catch{
    // Do not release a claim when provider/commit outcome is ambiguous.
    return failure('analysis_claim_unavailable','The analysis could not be safely confirmed. Your saved work is unchanged. Try again shortly.');
  }
}
