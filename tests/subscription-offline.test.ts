import {fetchWithRetry} from '../supabase/functions/_shared/provider-retry.ts';
import {reserveModelCall,SecurityLimit} from '../supabase/functions/_shared/security.ts';
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
Deno.test('development provider block precedes budgets, custom transports and retries',async()=>{
 const old=Deno.env.get('AI_PROVIDER_CALLS_DISABLED'),original=globalThis.fetch;let traffic=0,waits=0;
 Deno.env.set('AI_PROVIDER_CALLS_DISABLED','true');
 globalThis.fetch=async()=>{traffic++;return Response.json({allowed:true});};
 try{
  let admission:unknown;try{await reserveModelCall('workspace','actor',100,100);}catch(e){admission=e;}
  assert(admission instanceof SecurityLimit&&admission.code==='provider_calls_disabled','Budget admission ignored offline mode');
  for(const fetcher of [undefined,async()=>{traffic++;return new Response('{}');}]){
   let error:unknown;try{await fetchWithRetry('https://api.openai.com/v1/responses',{}, {maxRetries:4,fetcher,wait:async()=>{waits++;}});}catch(e){error=e;}
   assert(error instanceof Error&&error.message==='provider_calls_disabled','Provider block bypassed');
  }
  assert(traffic===0&&waits===0,'Disabled traffic reached network or retry loop');
 }finally{globalThis.fetch=original;if(old===undefined)Deno.env.delete('AI_PROVIDER_CALLS_DISABLED');else Deno.env.set('AI_PROVIDER_CALLS_DISABLED',old);}
});
Deno.test('provider block is rechecked between retry attempts',async()=>{
 const old=Deno.env.get('AI_PROVIDER_CALLS_DISABLED');let calls=0;
 Deno.env.delete('AI_PROVIDER_CALLS_DISABLED');
 try{
  let failure:unknown;try{await fetchWithRetry('https://api.openai.com/v1/responses',{}, {fetcher:async()=>{calls++;return new Response('{}',{status:500});},wait:async()=>{Deno.env.set('AI_PROVIDER_CALLS_DISABLED','true');}});}catch(e){failure=e;}
  assert(calls===1&&failure instanceof Error&&failure.message==='provider_calls_disabled','Retry ignored provider shutdown');
 }finally{if(old===undefined)Deno.env.delete('AI_PROVIDER_CALLS_DISABLED');else Deno.env.set('AI_PROVIDER_CALLS_DISABLED',old);}
});
