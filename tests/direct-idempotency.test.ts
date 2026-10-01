import {canonical,fingerprint,withDirectIdempotency} from '../supabase/functions/_shared/direct-idempotency.ts';
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
Deno.test('semantic keys preserve changed evidence and ignore object key order',async()=>{
 assert(canonical({a:1,b:2})===canonical({b:2,a:1}),'key order changed identity');
 assert(await fingerprint({text:'A'})!==await fingerprint({text:'B'}),'different evidence collided');
 assert(await fingerprint([1,2])!==await fingerprint([2,1]),'array evidence order lost');
});
Deno.test('two devices share one durable claim, provider call and result; actors stay isolated',async()=>{
 const original=globalThis.fetch,rows=new Map<string,{claim:string,body?:unknown}>();let calls=0;
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body)),key=body.p_workspace+':'+body.p_actor+':'+body.p_fingerprint;
  assert(new Headers(init?.headers).get('Authorization')==='Bearer private','ledger used client credentials');
  if(String(url).includes('claim_direct')){
   let row=rows.get(key);if(!row){row={claim:body.p_claim};rows.set(key,row);}
   return json(row.body?{state:'complete',body:row.body}:{state:row.claim===body.p_claim?'owner':'processing'});
  }
  const row=rows.get(key)!;assert(row.claim===body.p_claim,'wrong owner finished claim');
  if(body.p_body===null)rows.delete(key);else row.body=body.p_body;
  return json(true);
 };
 const options={workspace:'w',actor:'a',payload:{text:'identical'},base:'https://db.invalid',serviceKey:'private',
  wait:()=>new Promise<void>(r=>setTimeout(r,1)),execute:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return json({result:42});}};
 try{
  const responses=await Promise.all([withDirectIdempotency(options),withDirectIdempotency(options)]);
  assert(calls===1,'concurrent devices reached provider twice');
  for(const r of responses)assert(r.ok&&(await r.json()).result===42,'shared result missing');
  await withDirectIdempotency(options);assert(calls===1,'lost response retry charged again');
  await withDirectIdempotency({...options,actor:'b'});assert(Number(calls)===2,'cached result crossed actors');
  await withDirectIdempotency({...options,payload:{text:'changed'}});assert(Number(calls)===3,'new evidence reused stale result');
 }finally{globalThis.fetch=original;}
});
Deno.test('ledger outage, uncertainty and pending work never invoke the provider',async()=>{
 const original=globalThis.fetch;let state='processing',calls=0;
 globalThis.fetch=async()=>state==='offline'?json({},503):json({state});
 const options={workspace:'w',actor:'a',payload:{},base:'https://db.invalid',serviceKey:'private',polls:0,execute:async()=>{calls++;return json({});}};
 try{
  for(const s of ['processing','uncertain','offline','invalid']){state=s;const response=await withDirectIdempotency(options);assert(response.status===(s==='processing'?409:503),'wrong safe response');}
  assert(calls===0,'claim failure reached provider');
 }finally{globalThis.fetch=original;}
});
Deno.test('known failure releases a claim but provider or completion ambiguity does not',async()=>{
 const original=globalThis.fetch;let finished=0,completionFails=false;
 globalThis.fetch=async(url)=>{
  if(String(url).includes('claim_direct'))return json({state:'owner'});
  finished++;return completionFails?json({},503):json(true);
 };
 const options={workspace:'w',actor:'a',payload:{},base:'https://db.invalid',serviceKey:'private',execute:async()=>json({error:'rate limit'},429)};
 try{
  assert((await withDirectIdempotency(options)).status===429&&finished===1,'known failure not released');
  assert((await withDirectIdempotency({...options,execute:()=>Promise.reject(Error('disconnected'))})).status===503&&finished===1,'ambiguous provider call released');
  completionFails=true;assert((await withDirectIdempotency({...options,execute:async()=>json({ok:true})})).status===503,'unconfirmed result presented as durable');
 }finally{globalThis.fetch=original;}
});
